#!/usr/bin/env bash
# ==============================================================================
# Bootstrap GCP CI/CD Infrastructure for LivePulse
# - Workload Identity Federation (GitHub OIDC restricted to main branch)
# - Artifact Registry
# - Least-Privilege Runtime & Deployer Service Accounts
#
# Usage:
#   export GCP_PROJECT_ID="your-gcp-project-id"
#   export GCP_PROJECT_NUMBER="123456789012"
#   export GCP_REGION="europe-west4"
#   export GITHUB_REPO="owner/livepulse"
#   ./scripts/setup_gcp_cicd.sh
# ==============================================================================
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Error: Please export GCP_PROJECT_ID}"
PROJECT_NUMBER="${GCP_PROJECT_NUMBER:?Error: Please export GCP_PROJECT_NUMBER}"
REGION="${GCP_REGION:-europe-west4}"
GITHUB_REPO="${GITHUB_REPO:?Error: Please export GITHUB_REPO (e.g. owner/repo)}"
GAR_REPO="${GAR_REPO:-livepulse-repo}"
POOL_NAME="${POOL_NAME:-github-pool}"
PROVIDER_NAME="${PROVIDER_NAME:-github-provider}"
RUNTIME_SA_NAME="${RUNTIME_SA_NAME:-livepulse-runtime-sa}"
DEPLOYER_SA_NAME="${DEPLOYER_SA_NAME:-github-cicd-deployer}"

echo ">>> [1/6] Enabling required GCP APIs on ${PROJECT_ID}..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  aiplatform.googleapis.com \
  --project="${PROJECT_ID}"

echo ">>> [2/6] Creating Artifact Registry (${GAR_REPO}) in ${REGION}..."
gcloud artifacts repositories describe "${GAR_REPO}" \
  --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud artifacts repositories create "${GAR_REPO}" \
  --repository-format=docker \
  --location="${REGION}" \
  --description="LivePulse Docker Repository for GitHub Actions CI/CD" \
  --project="${PROJECT_ID}"

echo ">>> [3/6] Creating Runtime & CI/CD Service Accounts..."
gcloud iam service-accounts describe "${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud iam service-accounts create "${RUNTIME_SA_NAME}" \
  --display-name="LivePulse Cloud Run Runtime SA" \
  --project="${PROJECT_ID}"

gcloud iam service-accounts describe "${DEPLOYER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud iam service-accounts create "${DEPLOYER_SA_NAME}" \
  --display-name="GitHub Actions CI/CD Deployer SA" \
  --project="${PROJECT_ID}"

echo ">>> [4/6] Granting Least-Privilege IAM roles to Service Accounts..."
for ROLE in roles/aiplatform.user roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="${ROLE}" --condition=None --quiet >/dev/null
done

for ROLE in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser roles/cloudbuild.builds.editor; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${DEPLOYER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="${ROLE}" --condition=None --quiet >/dev/null
done

echo ">>> [5/6] Configuring Workload Identity Pool & GitHub OIDC Provider (restricted to main branch)..."
gcloud iam workload-identity-pools describe "${POOL_NAME}" \
  --location="global" --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud iam workload-identity-pools create "${POOL_NAME}" \
  --location="global" \
  --display-name="GitHub Actions Pool" \
  --project="${PROJECT_ID}"

if gcloud iam workload-identity-pools providers describe "${PROVIDER_NAME}" \
  --workload-identity-pool="${POOL_NAME}" \
  --location="global" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "${PROVIDER_NAME}" \
    --workload-identity-pool="${POOL_NAME}" \
    --location="global" \
    --attribute-condition="assertion.repository == '${GITHUB_REPO}' && assertion.ref == 'refs/heads/main'" \
    --project="${PROJECT_ID}"
else
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_NAME}" \
    --workload-identity-pool="${POOL_NAME}" \
    --location="global" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository == '${GITHUB_REPO}' && assertion.ref == 'refs/heads/main'" \
    --project="${PROJECT_ID}"
fi

echo ">>> [6/6] Binding GitHub repository (${GITHUB_REPO}) to Deployer SA..."
gcloud iam service-accounts add-iam-policy-binding \
  "${DEPLOYER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/attribute.repository/${GITHUB_REPO}" >/dev/null

echo "======================================================================"
echo "SUCCESS: GCP CI/CD & WIF configured for ${GITHUB_REPO} (main branch only)"
echo "Configure these 5 Secrets in GitHub (Settings -> Secrets -> Actions):"
echo "  GCP_PROJECT_ID   : ${PROJECT_ID}"
echo "  GCP_REGION       : ${REGION}"
echo "  GCP_WIF_PROVIDER : projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/providers/${PROVIDER_NAME}"
echo "  GCP_DEPLOYER_SA  : ${DEPLOYER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
echo "  GCP_RUNTIME_SA   : ${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
echo "======================================================================"
