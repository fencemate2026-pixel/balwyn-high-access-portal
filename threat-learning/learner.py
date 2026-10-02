"""
Continuous threat learning from audit logs.

Reads threat_detected + threat_labelled events from audit.jsonl,
trains a logistic regression model on staff-labelled incidents,
and outputs candidates that security staff can promote into service.

The model learns what a real threat looks like based on:
- detection_confidence (from thermal/radar/video fusion)
- approach_speed
- distance_from_gate
- location (gate approach vector)
- time_of_day
- historical outcomes (staff labels)
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

LOG = logging.getLogger("balwyn-threat-learner")

# =====================================================================
# Configuration
# =====================================================================

# Minimum training set size before learning is allowed
MIN_LABELLED = 20
MIN_TRUE_THREATS = 5
MIN_FALSE_ALARMS = 5

# Safety margins: model can only suppress alerts if it meets these thresholds
SAFETY_MARGIN = 0.5  # cutoff is lowest true threat confidence × this
NEVER_SUPPRESS_MULTIPLE = 1.5  # raw confidence must be below this multiple of threshold

# Model hyperparameters (deterministic, reproducible)
EPOCHS = 500
LEARNING_RATE = 0.15
L2_REGULARIZATION = 0.01
FOLDS = 3  # for out-of-fold validation

# Features the model learns from
FEATURES = ("confidence", "approach_speed", "distance_m", "hour_sin", "hour_cos")


# =====================================================================
# Feature engineering
# =====================================================================

def _hour_of_day(timestamp: str) -> Optional[float]:
    """Extract local hour (0-24, fractional) from ISO timestamp."""
    if not timestamp:
        return None
    try:
        dt = datetime.fromisoformat(timestamp)
        return dt.hour + dt.minute / 60.0
    except (ValueError, TypeError):
        return None


def features_from_event(event: Dict[str, Any]) -> Optional[List[float]]:
    """
    Extract feature vector from a threat_detected event.
    Returns None if any required field is missing.
    """
    confidence = event.get("confidence")
    approach_speed = event.get("approach_speed", 0.0)
    distance_m = event.get("distance_m")
    timestamp = event.get("t")

    if confidence is None or distance_m is None:
        return None

    hour = _hour_of_day(timestamp)
    if hour is None:
        return None

    try:
        confidence = float(confidence)
        approach_speed = float(approach_speed)
        distance_m = float(distance_m)
    except (TypeError, ValueError):
        return None

    if not all(math.isfinite(v) for v in (confidence, approach_speed, distance_m)):
        return None

    # Encode hour as a point on a circle so 23:00 and 01:00 are close
    angle = 2.0 * math.pi * hour / 24.0
    return [confidence, approach_speed, distance_m, math.sin(angle), math.cos(angle)]


# =====================================================================
# Logistic regression (standard library only, deterministic)
# =====================================================================

def _sigmoid(z: float) -> float:
    """Numerically stable sigmoid."""
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


@dataclass(frozen=True)
class _Fit:
    """A fitted logistic regression model."""
    means: List[float]
    stds: List[float]
    weights: List[float]
    bias: float

    def predict(self, x: Sequence[float]) -> float:
        """Predict probability that input is a real threat."""
        z = self.bias
        for value, mean, std, weight in zip(x, self.means, self.stds, self.weights):
            if std > 0:
                z += weight * (value - mean) / std
        return _sigmoid(z)


def _fit(xs: List[List[float]], ys: List[int]) -> _Fit:
    """Train logistic regression with L2 regularization and class weighting."""
    n, d = len(xs), len(FEATURES)

    # Standardize features
    means = [sum(x[j] for x in xs) / n for j in range(d)]
    stds = []
    for j in range(d):
        var = sum((x[j] - means[j]) ** 2 for x in xs) / n
        stds.append(math.sqrt(var) if var > 1e-12 else 1.0)

    zs = [[(x[j] - means[j]) / stds[j] for j in range(d)] for x in xs]

    # Class weighting (rare true threats get higher weight)
    positives = sum(ys)
    negatives = n - positives
    w_pos = n / (2.0 * positives) if positives > 0 else 0.0
    w_neg = n / (2.0 * negatives) if negatives > 0 else 0.0

    # Gradient descent
    weights = [0.0] * d
    bias = 0.0
    for _ in range(EPOCHS):
        grad_w = [0.0] * d
        grad_b = 0.0
        for z, y in zip(zs, ys):
            p = _sigmoid(bias + sum(w * v for w, v in zip(weights, z)))
            err = (p - y) * (w_pos if y else w_neg)
            grad_b += err
            for j in range(d):
                grad_w[j] += err * z[j]
        for j in range(d):
            weights[j] -= LEARNING_RATE * (grad_w[j] / n + L2_REGULARIZATION * weights[j])
        bias -= LEARNING_RATE * grad_b / n

    return _Fit(means=means, stds=stds, weights=weights, bias=bias)


def _out_of_fold_validation(xs: List[List[float]], ys: List[int]) -> List[float]:
    """
    Honest evaluation: score each example with a model that never saw it.
    Returns probability for each example in original order.
    """
    folds = [0] * len(ys)
    counters = {0: 0, 1: 0}
    for i, y in enumerate(ys):
        folds[i] = counters[y] % FOLDS
        counters[y] += 1

    probabilities = [0.0] * len(ys)
    for fold in range(FOLDS):
        train_idx = [i for i in range(len(ys)) if folds[i] != fold]
        test_idx = [i for i in range(len(ys)) if folds[i] == fold]
        if not test_idx:
            continue

        train_ys = [ys[i] for i in train_idx]
        if 0 < sum(train_ys) < len(train_ys):
            model = _fit([xs[i] for i in train_idx], train_ys)
            for i in test_idx:
                probabilities[i] = model.predict(xs[i])
        else:
            # Fold has only one class: use worst-case for safety
            for i in test_idx:
                probabilities[i] = 0.0 if ys[i] == 1 else 1.0

    return probabilities


# =====================================================================
# Model artefact
# =====================================================================

def _checksum(payload: Dict[str, Any]) -> str:
    """SHA256 of canonical JSON."""
    body = {k: v for k, v in payload.items() if k != "sha256"}
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


@dataclass
class Model:
    """A trained threat model plus eligibility checks."""

    payload: Dict[str, Any]

    @property
    def model_id(self) -> str:
        return self.payload["model_id"]

    @property
    def cutoff(self) -> Optional[float]:
        return self.payload.get("cutoff")

    @property
    def filter_allowed(self) -> bool:
        """Can this model hide alerts, or only advise?"""
        return bool(self.payload.get("filter_allowed"))

    @property
    def created_at(self) -> str:
        return self.payload.get("created_at", "")

    def predict(self, x: Sequence[float]) -> float:
        """Predict threat probability (0-1)."""
        p = self.payload
        return _Fit(p["means"], p["stds"], p["weights"], p["bias"]).predict(x)

    def explain(self, x: Sequence[float]) -> Dict[str, float]:
        """Each feature's contribution to the decision (log-odds)."""
        p = self.payload
        return {
            name: round(w * (v - m) / s, 4)
            for name, v, m, s, w in zip(FEATURES, x, p["means"], p["stds"], p["weights"])
            if s > 0
        }

    def verify(self) -> bool:
        """Check integrity."""
        return self.payload.get("sha256") == _checksum(self.payload)


# =====================================================================
# Training
# =====================================================================

def train(threat_events: Iterable[Dict[str, Any]],
          label_map: Dict[str, str]) -> tuple[Optional[Model], str]:
    """
    Train a threat model from labelled events.

    Args:
        threat_events: threat_detected events from audit.jsonl
        label_map: {detection_id -> "true_positive" | "false_positive" | "unsure"}

    Returns:
        (model, report_text) where model is None if training fails
    """
    usable: List[tuple[List[float], int]] = []
    skipped = 0

    for event in threat_events:
        detection_id = event.get("detection_id")
        if not detection_id or detection_id not in label_map:
            continue

        label = label_map[detection_id]
        if label == "unsure":
            skipped += 1
            continue
        if label not in ("true_positive", "false_positive"):
            continue

        x = features_from_event(event)
        if x is None:
            skipped += 1
            continue

        y = 1 if label == "true_positive" else 0
        usable.append((x, y))

    xs = [x for x, _ in usable]
    ys = [y for _, y in usable]
    n_true = sum(ys)
    n_false = len(ys) - n_true

    lines = [
        "Threat Learning Model",
        "=" * 50,
        f"Labelled threats (usable)    : {len(ys)}  (real {n_true}, false alarms {n_false})",
        f"Skipped (missing features)   : {skipped}",
    ]

    if n_true == 0 or n_false == 0:
        lines += [
            "",
            "Cannot train: need at least one confirmed real threat and one false alarm.",
            "Keep labelling incidents for the model to learn.",
        ]
        return None, "\n".join(lines)

    # Train and validate
    oof = _out_of_fold_validation(xs, ys)
    true_probs = [p for p, y in zip(oof, ys) if y == 1]
    false_probs = [p for p, y in zip(oof, ys) if y == 0]

    min_true_prob = min(true_probs)
    cutoff = min_true_prob * SAFETY_MARGIN

    would_hide_true = sum(1 for p in true_probs if p < cutoff)
    would_hide_false = sum(1 for p in false_probs if p < cutoff)

    # Check eligibility for "filter" mode
    reasons = []
    if len(ys) < MIN_LABELLED:
        reasons.append(f"fewer than {MIN_LABELLED} usable labels")
    if n_true < MIN_TRUE_THREATS:
        reasons.append(f"fewer than {MIN_TRUE_THREATS} confirmed real threats")
    if n_false < MIN_FALSE_ALARMS:
        reasons.append(f"fewer than {MIN_FALSE_ALARMS} confirmed false alarms")
    if would_hide_true > 0:
        reasons.append("out-of-fold cutoff would hide a real threat")

    filter_allowed = not reasons

    # Final fit on all data
    final = _fit(xs, ys)

    # Build payload
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    payload: Dict[str, Any] = {
        "schema": "balwyn-threat-learner/1",
        "features": list(FEATURES),
        "means": final.means,
        "stds": final.stds,
        "weights": final.weights,
        "bias": final.bias,
        "cutoff": cutoff,
        "safety_margin": SAFETY_MARGIN,
        "never_suppress_multiple": NEVER_SUPPRESS_MULTIPLE,
        "filter_allowed": filter_allowed,
        "filter_refused_because": reasons,
        "metrics": {
            "labelled": len(ys),
            "true_threats": n_true,
            "false_alarms": n_false,
            "skipped_missing_feature": skipped,
            "oof_min_true_probability": round(min_true_prob, 4),
            "oof_would_hide_false": would_hide_false,
            "oof_would_hide_true": would_hide_true,
        },
        "created_at": created_at,
    }

    # Generate model ID
    digest = _checksum({**payload, "model_id": ""})
    created_ts = created_at.replace(":", "").replace("-", "")[:15]
    payload["model_id"] = f"threat-model-{created_ts}-{digest[:8]}"
    payload["sha256"] = _checksum(payload)

    lines += [
        "",
        "Out-of-fold validation (each threat scored by a model that never saw it):",
        f"  minimum probability given to real threat    : {min_true_prob:.4f}",
        f"  cutoff (that × {SAFETY_MARGIN})                : {cutoff:.4f}",
        f"  real threats that cutoff would hide         : {would_hide_true}",
        f"  false alarms that cutoff would hide         : {would_hide_false}",
        "",
        f"Model ID: {payload['model_id']}",
        f"Filter mode permitted: {filter_allowed}",
        "" if filter_allowed else f"Reason: {reasons[0] if reasons else 'unknown'}",
    ]

    model = Model(payload)
    return model, "\n".join(lines)


# =====================================================================
# File I/O
# =====================================================================

def save_candidate(model: Model, models_dir: str) -> Path:
    """Save a candidate model to models_dir/candidates/."""
    models_dir_path = Path(models_dir)
    candidates_dir = models_dir_path / "candidates"
    candidates_dir.mkdir(parents=True, exist_ok=True)

    candidate_path = candidates_dir / f"{model.model_id}.json"
    candidate_path.write_text(json.dumps(model.payload, indent=2) + "\n")
    os.chmod(candidate_path, 0o600)

    return candidate_path


def load_file(path: str) -> Optional[Model]:
    """Load a model from a JSON file."""
    try:
        payload = json.loads(Path(path).read_text())
        model = Model(payload)
        if not model.verify():
            LOG.warning("Model integrity check failed: %s", path)
            return None
        return model
    except (OSError, json.JSONDecodeError, TypeError) as e:
        LOG.error("Failed to load model %s: %s", path, e)
        return None


def load_active(models_dir: str) -> tuple[Optional[Model], str]:
    """Load the currently active model, or None if none is active."""
    models_dir_path = Path(models_dir)
    active_file = models_dir_path / "active.json"

    if not active_file.exists():
        return None, "No active model"

    model = load_file(str(active_file))
    if model is None:
        return None, "Active model file is corrupt"

    return model, "Active"


def promote(models_dir: str, candidate_path: str, reviewer: str, confirm: str) -> str:
    """
    Promote a candidate model to active status.

    Args:
        models_dir: directory containing candidates/ and active.json
        candidate_path: path to candidates/*.json file
        reviewer: name of the person approving
        confirm: must be exactly "APPROVE"

    Returns:
        path to the active model file

    Raises:
        ValueError if validation fails
        PermissionError if confirm is wrong
    """
    if confirm != "APPROVE":
        raise PermissionError(f"confirm must be exactly 'APPROVE', got {confirm!r}")

    candidate = load_file(candidate_path)
    if candidate is None:
        raise ValueError(f"Cannot load candidate: {candidate_path}")

    if not candidate.filter_allowed:
        raise ValueError(
            f"Candidate does not meet filter eligibility: {candidate.filter_refused_because}"
        )

    models_dir_path = Path(models_dir)
    models_dir_path.mkdir(parents=True, exist_ok=True)

    active_file = models_dir_path / "active.json"
    audit_file = models_dir_path / "promotions.jsonl"

    # Atomically swap: write to temp, rename
    tmp_file = active_file.with_suffix(".tmp")
    tmp_file.write_text(json.dumps(candidate.payload, indent=2) + "\n")
    os.chmod(tmp_file, 0o600)
    tmp_file.replace(active_file)

    # Audit the promotion
    audit_entry = {
        "promoted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model_id": candidate.model_id,
        "reviewer": reviewer[:64],
        "metrics": candidate.payload.get("metrics", {}),
    }
    audit_file.write_text(json.dumps(audit_entry) + "\n", mode="a")
    os.chmod(audit_file, 0o600)

    LOG.info("Model promoted: %s by %s", candidate.model_id, reviewer)
    return str(active_file)
