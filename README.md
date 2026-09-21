# LivePulse — Vertex AI Gemini Live Real-Time Voice Console

**LivePulse** est une console vocale bidirectionnelle temps réel connectée à l'API **Google Cloud Vertex AI Gemini Live** (`gemini-3.8-live-preview`, `gemini-3.8-live`, `gemini-3.1-live`), conçue avec une esthétique matérielle inspirée du design industriel **Braun / Dieter Rams / Teenage Engineering**.

---

## ✨ Fonctionnalités Principales

* **Streaming Vocal Bidirectionnel Temps Réel (`16 kHz PCM IN` / `24 kHz PCM OUT`)** :
  * Capture microphone Web Audio API à `16 kHz` avec annulation d'écho, suppression de bruit et détection d'interruption naturelle (*Barge-in* temps réel).
  * Lecture audio `24 kHz` sans latence via file d'attente Web Audio et analyseur fréquentiel FFT.
* **Avatar Vocal Interactif 60 FPS (`MOD. A // AVATAR VOCAL INTERACTIF`)** :
  * Portrait studio animé à 60 FPS au centre de l'écran OLED avec synchronisation labiale (*lip-sync*) pilotée par les formants vocaux (`24 kHz`), clignement naturel des yeux et bascule automatique du genre (**Féminin** : `Aoede`, `Kore`, `Leda`, `Zephyr` / **Masculin** : `Puck`, `Charon`, `Fenrir`, `Orus`).
* **Reconfiguration à Chaud dans le Ruban Supérieur (`REGION`, `MODEL`, `VOICE`)** :
  * Toute modification de la **Région** (`us-central1`, `europe-west1`, `europe-west4`, `europe-west9`), du **Modèle** (`gemini-3.8-live-preview`, `gemini-3.8-live`, `gemini-3.1-live`, `gemini-live-2.5-flash-native-audio`) ou de la **Voix** redémarre automatiquement la session Live pour appliquer les nouveaux paramètres.
* **Pont Hybride HTTP-Live & WebSocket** :
  * Compatible à 100 % avec les proxies d'entreprise et Google Cloud Run (avec affinité de session).

---

## 🏗️ Architecture du Projet

```text
.
├── app.py                              # Backend FastAPI + Pont Vertex AI Gemini Live (google-genai SDK)
├── run_servers.py                      # Lanceur local dual-stack (HTTP :8765 + HTTPS auto-signé :8766)
├── Dockerfile                          # Image de production durcie (Python 3.12-slim, utilisateur non-root)
├── requirements.txt                    # Dépendances de production épinglées
├── requirements-dev.txt                # Outils de test et d'audit de sécurité (pytest, bandit, pip-audit)
├── static/
│   ├── index.html                      # Interface matérielle LivePulse
│   ├── styles.css                      # Design system industriel Braun / Teenage Engineering
│   ├── app.js                          # Moteur Web Audio 16k/24k + Avatar 60 FPS + Client Live
│   └── avatar_*.jpg                    # Keyframes studio 1024x1024 (idle, speaking, blink - F/M)
├── tests/
│   └── test_app.py                     # Suite de tests fonctionnels & d'en-têtes de sécurité (Pytest)
├── scripts/
│   └── setup_gcp_cicd.sh               # Script d'initialisation GCP (WIF, Artifact Registry, IAM)
└── .github/workflows/
    └── ci-cd-cloudrun.yml              # Pipeline CI/CD GitHub Actions (Tests + Sécurité -> Cloud Run)
```

---

## 🚀 Exécution en Local

### 1. Prérequis
* Python `3.11+` ou `3.12+`
* Authentification Google Cloud Application Default Credentials (ADC) :
  ```bash
  gcloud auth application-default login
  export GOOGLE_CLOUD_PROJECT="votre-projet-gcp"
  ```

### 2. Installation & Démarrage
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements-dev.txt

# Lancer le serveur (HTTP sur :8765 et HTTPS sur :8766)
python run_servers.py
```
Ouvrez ensuite **`http://localhost:8765`** (ou **`https://localhost:8766`**).

---

## 🧪 Tests Fonctionnels & Audits de Sécurité

Avant chaque déploiement, trois contrôles automatisés valident le fonctionnement et la sécurité de l'application :

```bash
# 1. Tests fonctionnels FastAPI, UI & cycle de vie de session Live (Pytest)
python -m pytest tests/ -v

# 2. Analyse statique de sécurité du code Python (Bandit)
bandit -r app.py -ll -ii

# 3. Audit des vulnérabilités CVE sur les dépendances (pip-audit via OSV)
pip-audit -r requirements.txt --vulnerability-service osv
```

---

## 🔐 Sécurité & Chaîne CI/CD GitHub Actions → Cloud Run

### Bonnes Pratiques DevSecOps Appliquées
1. **Zéro identifiant GCP en dur dans le code ou le workflow YAML** :
   * Aucun `PROJECT_ID`, `PROJECT_NUMBER` ni email de `Service Account` n'est stocké en clair dans le dépôt Git.
   * Toutes les valeurs sensibles d'infrastructure sont injectées via **GitHub Actions Encrypted Secrets** (`${{ secrets.* }}`), ce qui les masque automatiquement (`***`) dans les journaux de build.
2. **Authentification Sans Clé (Workload Identity Federation OIDC)** :
   * Aucune clé JSON de compte de service n'est créée (`constraints/iam.disableServiceAccountKeyCreation` respecté).
   * Le fournisseur OIDC Google Cloud vérifie cryptographiquement que le jeton provient **exclusivement** de ce dépôt GitHub **et** de la branche `refs/heads/main`.
3. **Moindre Privilège (Least Privilege IAM) & Conteneur Non-Root** :
   * Séparation stricte entre le compte de déploiement CI/CD (`github-cicd-deployer`) et le compte d'exécution Cloud Run (`livepulse-runtime-sa`, limité à `roles/aiplatform.user` et `roles/logging.logWriter`).
   * Le conteneur Docker s'exécute sous l'utilisateur système non-privilégié `appuser`.

### Configuration des Secrets GitHub Actions
Dans votre dépôt GitHub (**Settings → Secrets and variables → Actions → New repository secret**), les 5 secrets suivants alimentent [`.github/workflows/ci-cd-cloudrun.yml`](.github/workflows/ci-cd-cloudrun.yml) :

| Nom du Secret GitHub | Description |
| :--- | :--- |
| `GCP_PROJECT_ID` | Identifiant du projet Google Cloud cible |
| `GCP_REGION` | Région de déploiement Cloud Run & Artifact Registry (ex. `europe-west4`) |
| `GCP_WIF_PROVIDER` | Ressource complète du fournisseur Workload Identity (`projects/<NUM>/locations/global/workloadIdentityPools/github-pool/providers/github-provider`) |
| `GCP_DEPLOYER_SA` | Email du Service Account utilisé par GitHub Actions pour builder et déployer |
| `GCP_RUNTIME_SA` | Email du Service Account attaché au conteneur Cloud Run en production |

### Bootstrap Initial de l'Infrastructure GCP
Pour provisionner automatiquement Artifact Registry, les Service Accounts et Workload Identity Federation sur un nouveau projet GCP :

```bash
export GCP_PROJECT_ID="votre-projet-gcp"
export GCP_PROJECT_NUMBER="123456789012"
export GCP_REGION="europe-west4"
export GITHUB_REPO="votre-org/livepulse"

./scripts/setup_gcp_cicd.sh
```
