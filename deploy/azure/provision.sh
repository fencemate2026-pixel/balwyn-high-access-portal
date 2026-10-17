#!/usr/bin/env bash
# =============================================================================
# Provision the Magic Keys portal on Azure (Australia East, Sydney — the same
# city as the Supabase database, so every database call stays in Australia).
#
# Creates: resource group, container registry, Linux App Service plan, web app
# running the portal container, managed identity with pull-only registry
# access, health check, HTTPS-only, TLS 1.2+, and an access restriction so the
# app only accepts traffic that comes through Cloudflare (the portal's rate
# limits trust Cloudflare's client-IP header; a direct request must not be able
# to forge it).
#
# It creates NO secrets. Secrets are entered afterwards (see app-settings.md).
# Safe to re-run: each step checks before creating.
#
# Prerequisites: Azure CLI logged in (az login) with rights on the subscription.
# Usage:  bash deploy/azure/provision.sh
# =============================================================================
set -euo pipefail

SUBSCRIPTION="${AZ_SUBSCRIPTION:?Set AZ_SUBSCRIPTION to the subscription ID}"
LOCATION="${AZ_LOCATION:-australiaeast}"
RG="${AZ_RG:-rg-magickeys-balwyn}"
ACR="${AZ_ACR:-magickeysbalwyn}"            # registry names: lowercase letters/digits only
PLAN="${AZ_PLAN:-asp-magickeys-balwyn}"
APP="${AZ_APP:-magickeys-balwyn-portal}"
SKU="${AZ_SKU:-P0v3}"                       # always-on capable; change if sizing differs
IMAGE="${ACR}.azurecr.io/magickeys-portal:initial"

az account set --subscription "$SUBSCRIPTION"

echo "== Resource group ($LOCATION)"
az group create --name "$RG" --location "$LOCATION" --output none

echo "== Container registry"
az acr show --name "$ACR" --resource-group "$RG" --output none 2>/dev/null \
  || az acr create --name "$ACR" --resource-group "$RG" --sku Basic --admin-enabled false --output none

echo "== App Service plan (Linux)"
az appservice plan show --name "$PLAN" --resource-group "$RG" --output none 2>/dev/null \
  || az appservice plan create --name "$PLAN" --resource-group "$RG" --is-linux --sku "$SKU" --output none

echo "== Web app (container)"
az webapp show --name "$APP" --resource-group "$RG" --output none 2>/dev/null \
  || az webapp create --name "$APP" --resource-group "$RG" --plan "$PLAN" \
       --deployment-container-image-name "mcr.microsoft.com/appsvc/staticsite:latest" --output none

echo "== Managed identity with pull-only access to the registry"
PRINCIPAL=$(az webapp identity assign --name "$APP" --resource-group "$RG" --query principalId -o tsv)
ACR_ID=$(az acr show --name "$ACR" --resource-group "$RG" --query id -o tsv)
az role assignment create --assignee-object-id "$PRINCIPAL" --assignee-principal-type ServicePrincipal \
  --role AcrPull --scope "$ACR_ID" --output none 2>/dev/null || true
az webapp config set --name "$APP" --resource-group "$RG" \
  --generic-configurations '{"acrUseManagedIdentityCreds": true}' --output none

echo "== Runtime settings: HTTPS only, TLS 1.2+, always on, health check, port"
az webapp update --name "$APP" --resource-group "$RG" --https-only true --output none
az webapp config set --name "$APP" --resource-group "$RG" \
  --min-tls-version 1.2 --ftps-state Disabled --always-on true \
  --http20-enabled true --generic-configurations '{"healthCheckPath": "/api/health"}' --output none
az webapp config appsettings set --name "$APP" --resource-group "$RG" --output none --settings \
  WEBSITES_PORT=8080 PORT=8080 NODE_ENV=production \
  SUPABASE_URL=https://aevsfrxqyvtuycufffxk.supabase.co

echo "== Only accept traffic from Cloudflare"
# Cloudflare publishes its edge ranges; the app refuses everything else.
# Covers both IPv4 and IPv6 (AUDIT_INFRA.md finding #10: ips-v6 was missing,
# leaving an IPv6-only visitor or future IPv6 Cloudflare edge unaccounted for).
# This script is idempotent and safe to re-run, but it is still only ever run
# by hand: Cloudflare can add or retire ranges at any time, so re-run this
# section periodically (there is no scheduled job wired up for it) rather than
# treating a single run as a permanent allow-list.
PRIORITY=100
for CIDR in $(curl -fsS https://www.cloudflare.com/ips-v4) $(curl -fsS https://www.cloudflare.com/ips-v6); do
  NAME="cf-$(echo "$CIDR" | tr './:' '---')"
  az webapp config access-restriction show --name "$APP" --resource-group "$RG" --query "ipSecurityRestrictions[?name=='$NAME']" -o tsv | grep -q . \
    || az webapp config access-restriction add --name "$APP" --resource-group "$RG" \
         --rule-name "$NAME" --action Allow --ip-address "$CIDR" --priority "$PRIORITY" --output none
  PRIORITY=$((PRIORITY + 1))
done

echo
echo "Done. Next: enter the secrets listed in deploy/azure/app-settings.md, then run"
echo "the GitHub Actions workflow 'Deploy to Azure' to build and ship the image."
echo "Default hostname: https://${APP}.azurewebsites.net (Cloudflare-only once DNS points here)."
