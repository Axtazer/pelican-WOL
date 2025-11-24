# 🚀 Serveur Wake-on-LAN avec Auto-Setup

Serveur Node.js intelligent qui **détecte automatiquement** vos interfaces réseau au démarrage.

## ✨ Nouveautés Auto-Setup

### 🔍 Détection automatique
- ✅ Scanne toutes les interfaces réseau disponibles
- ✅ Identifie automatiquement l'interface locale (eth0, ens18, etc.)
- ✅ Identifie automatiquement l'interface Docker (docker0, br-*, etc.)
- ✅ Calcule les adresses broadcast automatiquement
- ✅ Sauvegarde la configuration pour les redémarrages

### 🎯 Configuration simplifiée

**Mode automatique (recommandé)** - Aucune configuration requise !
```bash
docker run -d \
  --network host \
  --cap-add NET_RAW \
  -e SERVER_PORT=3000 \
  -e API_KEY=votre-cle \
  wol-server
```

**Mode semi-automatique** - Juste indiquer le préfixe réseau
```bash
docker run -d \
  --network host \
  --cap-add NET_RAW \
  -e SERVER_PORT=3000 \
  -e LOCAL_NETWORK_PREFIX=192.168 \
  -e API_KEY=votre-cle \
  wol-server
```

**Mode manuel** - Configuration complète
```bash
docker run -d \
  --network host \
  --cap-add NET_RAW \
  -e SERVER_PORT=3000 \
  -e AUTO_DETECT=false \
  -e LOCAL_INTERFACE=eth0 \
  -e DOCKER_INTERFACE=docker0 \
  -e API_KEY=votre-cle \
  wol-server
```

## 📋 Variables d'environnement

### Variables essentielles
| Variable | Description | Défaut |
|----------|-------------|--------|
| `SERVER_PORT` | Port d'écoute HTTP | `3000` |
| `API_KEY` | Clé d'authentification | `""` |

### Variables d'auto-détection
| Variable | Description | Défaut |
|----------|-------------|--------|
| `AUTO_DETECT` | Active l'auto-détection | `true` |
| `LOCAL_NETWORK_PREFIX` | Préfixe réseau local (ex: "192.168") | `null` |
| `DOCKER_NETWORK_PREFIX` | Préfixe réseau Docker | `"172"` |
| `EXCLUDE_INTERFACES` | Interfaces à ignorer (séparées par virgules) | `"lo"` |

### Variables de configuration manuelle (optionnelles)
| Variable | Description | Défaut |
|----------|-------------|--------|
| `LOCAL_INTERFACE` | Nom interface locale | auto-détecté |
| `DOCKER_INTERFACE` | Nom interface Docker | auto-détecté |
| `WOL_PORT` | Port UDP WOL | `9` |

## 🎮 API Endpoints

### GET /health
Vérifie l'état et les interfaces détectées.

```bash
curl http://localhost:3000/health
```

**Réponse:**
```json
{
  "status": "ok",
  "autoDetect": true,
  "interfaces": {
    "local": {
      "name": "eth0",
      "ip": "192.168.1.100",
      "broadcast": "192.168.1.255"
    },
    "docker": {
      "name": "docker0",
      "ip": "172.17.0.1",
      "broadcast": "172.17.255.255"
    }
  },
  "allInterfaces": 3
}
```

### GET /interfaces
Liste toutes les interfaces détectées (authentifié).

```bash
curl -H "X-API-Key: votre-cle" http://localhost:3000/interfaces
```

**Réponse:**
```json
{
  "configured": {
    "local": {
      "name": "eth0",
      "address": "192.168.1.100",
      "netmask": "255.255.255.0",
      "broadcast": "192.168.1.255",
      "isLocal": true,
      "isDocker": false
    },
    "docker": {
      "name": "docker0",
      "address": "172.17.0.1",
      "netmask": "255.255.0.0",
      "broadcast": "172.17.255.255",
      "isLocal": false,
      "isDocker": true
    }
  },
  "all": [...]
}
```

### POST /interfaces/detect
Force une nouvelle détection des interfaces.

```bash
curl -X POST \
  -H "X-API-Key: votre-cle" \
  http://localhost:3000/interfaces/detect
```

### POST /wake
Envoie un paquet WOL (interface locale par défaut).

```bash
# Via interface auto-détectée (locale)
curl -X POST http://localhost:3000/wake \
  -H "Content-Type: application/json" \
  -H "X-API-Key: votre-cle" \
  -d '{"mac": "AA:BB:CC:DD:EE:FF"}'

# Via interface spécifique (type)
curl -X POST http://localhost:3000/wake \
  -H "Content-Type: application/json" \
  -H "X-API-Key: votre-cle" \
  -d '{"mac": "AA:BB:CC:DD:EE:FF", "interface": "docker"}'

# Via nom d'interface
curl -X POST http://localhost:3000/wake \
  -H "Content-Type: application/json" \
  -H "X-API-Key: votre-cle" \
  -d '{"mac": "AA:BB:CC:DD:EE:FF", "interface": "eth0"}'
```

### POST /wake-all
Envoie sur toutes les interfaces configurées.

```bash
curl -X POST http://localhost:3000/wake-all \
  -H "Content-Type: application/json" \
  -H "X-API-Key: votre-cle" \
  -d '{"mac": "AA:BB:CC:DD:EE:FF"}'
```

## 🔧 Configuration Pterodactyl

1. **Importer l'egg** `egg-wol-server.json`
2. **Créer un serveur**
3. **Variables minimales à configurer:**
   - `SERVER_PORT`: 25565 (ou autre port alloué)
   - `API_KEY`: Une clé secrète forte
   - `LOCAL_NETWORK_PREFIX`: Votre réseau (ex: "192.168.1")

4. **Laisser vides pour auto-détection:**
   - `LOCAL_INTERFACE`
   - `DOCKER_INTERFACE`

## 📊 Logs au démarrage

```
============================================================
🚀 Serveur Wake-on-LAN démarré
============================================================
📍 Écoute sur: 0.0.0.0:3000
🔐 API Key: ***configurée***
🔍 Auto-détection: ✅ Activée
📡 WOL Port: 9

🔍 Démarrage de l'auto-détection des interfaces...

📡 3 interface(s) détectée(s):
  - eth0: 192.168.1.100 (Docker: false, Local: true)
  - docker0: 172.17.0.1 (Docker: true, Local: false)
  - wlan0: 192.168.1.101 (Docker: false, Local: true)

✅ Interface LOCALE détectée: eth0 (192.168.1.100)
✅ Interface DOCKER détectée: docker0 (172.17.0.1)

💾 Configuration sauvegardée dans network-config.json

🏠 Interface LOCALE:
   Nom: eth0
   IP: 192.168.1.100
   Broadcast: 192.168.1.255

🐳 Interface DOCKER:
   Nom: docker0
   IP: 172.17.0.1
   Broadcast: 172.17.255.255

============================================================
```

## 🎯 Algorithme de détection

### Interface locale
1. Vérifier le préfixe réseau (`LOCAL_NETWORK_PREFIX`)
2. Patterns de noms: `eth*`, `ens*`, `enp*`, `eno*`, `wlan*`
3. Prioriser `eth0` puis `ens*`

### Interface Docker
1. Patterns de noms: `docker*`, `br-*`, `veth*`
2. Vérifier le préfixe réseau `172.*`
3. Prioriser `docker0`

## 💡 Cas d'usage

### Scénario 1: Installation simple
```bash
docker run -d --network host --cap-add NET_RAW \
  -e API_KEY=secret123 \
  wol-server
```
✅ Tout est détecté automatiquement !

### Scénario 2: Réseau personnalisé
```bash
docker run -d --network host --cap-add NET_RAW \
  -e API_KEY=secret123 \
  -e LOCAL_NETWORK_PREFIX=10.0 \
  wol-server
```
✅ Détecte les interfaces sur 10.0.*.* comme locales

### Scénario 3: Configuration fixe
```bash
docker run -d --network host --cap-add NET_RAW \
  -e API_KEY=secret123 \
  -e AUTO_DETECT=false \
  -e LOCAL_INTERFACE=ens18 \
  -e DOCKER_INTERFACE=br-1234567890ab \
  wol-server
```
✅ Utilise exactement les interfaces spécifiées

## 🛠️ Troubleshooting

### Vérifier les interfaces disponibles
```bash
# Dans le container
docker exec -it wol-server ip addr show
```

### Forcer une nouvelle détection
```bash
curl -X POST -H "X-API-Key: votre-cle" \
  http://localhost:3000/interfaces/detect
```

### Voir la configuration sauvegardée
```bash
docker exec -it wol-server cat /app/network-config.json
```