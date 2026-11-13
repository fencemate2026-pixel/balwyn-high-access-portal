# External fire, smoke and threat references

These notes are for people building the portal. Ask Magic Keys does not read this file. The staff guide is the only text the assistant can use, and that guide must not contain web addresses.

Nothing here is installed as the school's detector. A camera result must not open a gate, close a gate, start evacuation, or replace the fire indicator panel or a person. Do not call a student, staff member or visitor armed or a threat because a model said so.

The photo zip is attached to the release [fire-smoke-dataset-1](https://github.com/fencemate2026-pixel/balwyn-high-access-portal/releases/tag/fire-smoke-dataset-1). The asset is 320,963,592 bytes, SHA-256 `d69852219c08c3a102e7df929f0e950eb17613c0324e61255a77eb80b386dc97`. A normal Git commit cannot hold it because GitHub rejects a file over 100 MB. A Git LFS push was rejected because the account's LFS budget is already used up. The zip contains no licence file. The same file is also on the workstation at `C:\Users\User\Downloads\FIRE-SMOKE-DATASET.zip`.

## Photo set

Counted from the zip on 14 November 2026. 3,000 JPEG files and no other files. There are no boxes and no caption file. The only label is the folder.

| Split | Fire | Smoke | Ordinary scene | Total |
| --- | ---: | ---: | ---: | ---: |
| Train | 900 | 900 | 900 | 2,700 |
| Test | 100 | 100 | 100 | 300 |

The folder name for an ordinary scene is `Neutral`. Photos are named `image_0.jpg` and so on. They are close, bright, centred photographs of fire and smoke. They are not pictures of this school. A model that learns only from them will miss a small fire far from the camera and can fire on a red vest, a sunset or a sunlit car roof.

This layout matches the published [DeepQuestAI Fire-Smoke-Dataset](https://github.com/DeepQuestAI/Fire-Smoke-Dataset) release, whose download is also named `FIRE-SMOKE-DATASET.zip`: 1,000 images in each class, 900 for training and 100 for testing. The local file was not re-downloaded, so this note does not claim the bytes are identical to that release. The repository listing has no licence file. The README says a ResNet50 model reached 85% on the test split. That claim has not been checked here. The same README's own examples include a smoke picture scored at about 0.446, next to another smoke picture scored at about 0.997.

## External projects

- [Fire-Smoke-Detection](https://github.com/imsaksham-c/Fire-Smoke-Detection) — an external OpenCV/PyTorch classification project. Its README reports 93% validation accuracy. That claim has not been checked here.
- [Real-Time-Smoke-Fire-Detection-System](https://github.com/mirzayasirabdullahbaig07/Real-Time-Smoke-Fire-Detection-System) — Yasir Baig's educational Streamlit app. Custom YOLO11 weights on a still photo, a video, or a webcam. It draws a box and a confidence score for fire or smoke, and it can brighten a dim frame with CLAHE before it looks. On a live camera it can email one snapshot and then wait 60 seconds. The repository says it is for education and research and does not include a standard software licence in the files reviewed here. Do not copy its application code or its weight files into this repository. Do not put mail passwords in git.
- [unified-threat-detection](https://github.com/priyanthan11/unified-threat-detection) — Priyanthan Theverasa's personal project, MIT licence, copyright 2026. One YOLO11s model, 21 classes: short gun, long gun, knife, fire, smoke, phone, and everyday objects such as person, car, bag and umbrella. The README's held-out test is 2,470 images and 6,780 instances at confidence 0.7. The author reports recall and precision of short gun 0.81 / 0.96, long gun 0.71 / 0.97, phone 0.80 / 0.98, knife 0.58 / 0.90, fire 0.58 / 0.96, smoke 0.50 / 0.95, and overall precision 0.91. Those numbers are the author's report. They have not been repeated here. The same README says the training pictures are clean staged close-ups, so blurred wide camera views miss more often, and broom, pen, fog and steam were never measured. The released weights are Git LFS and are not copied here.
- [fire-detection-system-using-python-opencv](https://github.com/gunarakulangunaretnam/fire-detection-system-using-python-opencv) — a small Python and OpenCV prototype, Apache License 2.0. It converts a frame to HSV and keeps pixels in a fire-like colour range. It can play an alarm sound and send mail. It is not a trained model. Sunsets, red clothing and vehicle lights can pass the same colour test. The script is not copied here.
- [Smart-CCTV-survillance](https://github.com/SAMUDRAGUPTA002/Smart-CCTV-survillance) — Shivam Dave's project, MIT licence. The README describes YOLO detection of fire, smoke, weapons, people and vehicles, plus a marked-area alert, saved screenshots, and a language-model incident note. The warehouse smoke note in that README is a sample, not a measured event. The README also lists face recognition and number-plate recognition as future work. Magic Keys must not do either, and a detection must not operate a gate. No accuracy figure in that README has been checked here. The code is not copied here.
- [AI-Surveillance-Detection-System](https://github.com/AdityaNarvekar1/AI-Surveillance-Detection-System) — a Streamlit research screen. The README says YOLO weights for guns and knives, separate YOLO weights for fire and smoke, and a CNN for fighting, with a downloadable alert list of time, type and confidence. No accuracy figure is published there, and no licence file was seen in the README. The weight files are not copied here. Magic Keys must not decide that a person is violent from a camera.

The same facts, without web addresses, are in `SOFTWARE_HELP.md` under "Fire and smoke reference pictures", "Camera research on fire, smoke and weapons", and "Colour alarm, fighting and incident notes". The assistant can quote that text. It still cannot see the photos.
