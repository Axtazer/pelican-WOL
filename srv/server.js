require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const dgram = require('dgram');
const os = require('os');
const fs = require('fs');
const path = require('path');
const app = express();

// Configuration depuis les variables d'environnement
const SERVER_PORT = parseInt(process.env.SERVER_PORT) || 3000;
const SERVER_IP = process.env.SERVER_IP || '0.0.0.0'; // Utiliser l'IP du port principal Pterodactyl
const WOL_PORT = parseInt(process.env.WOL_PORT) || 9;
const API_KEY = process.env.API_KEY || '';

// Variables pour l'auto-détection
const AUTO_DETECT = process.env.AUTO_DETECT !== 'false'; // Active par défaut
const LOCAL_INTERFACE = process.env.LOCAL_INTERFACE || null;
const DOCKER_INTERFACE = process.env.DOCKER_INTERFACE || null;
const EXCLUDE_INTERFACES = (process.env.EXCLUDE_INTERFACES || 'lo').split(',');
const LOCAL_NETWORK_PREFIX = process.env.LOCAL_NETWORK_PREFIX || null; // ex: "192.168"
const DOCKER_NETWORK_PREFIX = process.env.DOCKER_NETWORK_PREFIX || '172'; // Réseau Docker typique

app.use(express.json());

// Classe pour gérer la configuration réseau
class NetworkConfig {
    constructor() {
        this.localInterface = null;
        this.dockerInterface = null;
        this.allInterfaces = [];
        this.configPath = path.join(__dirname, 'network-config.json');
    }

    // Détecte toutes les interfaces réseau valides
    detectAllInterfaces() {
        const interfaces = os.networkInterfaces();
        const validInterfaces = [];

        for (const [name, addrs] of Object.entries(interfaces)) {
            // Ignorer les interfaces exclues
            if (EXCLUDE_INTERFACES.includes(name)) {
                continue;
            }

            const ipv4 = addrs.find(addr => 
                addr.family === 'IPv4' && !addr.internal
            );

            if (ipv4) {
                const broadcast = this.calculateBroadcast(ipv4.address, ipv4.netmask);
                validInterfaces.push({
                    name,
                    address: ipv4.address,
                    netmask: ipv4.netmask,
                    broadcast,
                    mac: ipv4.mac || 'N/A',
                    isDocker: this.isDockerInterface(name, ipv4.address),
                    isLocal: this.isLocalInterface(name, ipv4.address)
                });
            }
        }

        return validInterfaces;
    }

    // Détermine si c'est une interface Docker
    isDockerInterface(name, ip) {
        // Dans un conteneur Pterodactyl, l'interface principale n'est PAS Docker
        // Docker utilise des bridges comme docker0, br-xxx, veth
        const dockerPatterns = [
            /^docker\d+$/,
            /^br-[a-f0-9]{12}$/,
            /^veth[a-f0-9]+$/
        ];

        // Vérifier uniquement le nom pour les patterns Docker
        return dockerPatterns.some(pattern => pattern.test(name));
    }

    // Détermine si c'est une interface locale
    isLocalInterface(name, ip) {
        // Dans un conteneur, eth0 est l'interface principale
        if (name === 'eth0') {
            return true;
        }

        // Si un préfixe est spécifié, l'utiliser
        if (LOCAL_NETWORK_PREFIX && ip.startsWith(LOCAL_NETWORK_PREFIX)) {
            return true;
        }

        // Patterns typiques d'interfaces physiques
        const localPatterns = [
            /^eth\d+$/,
            /^ens\d+$/,
            /^enp\d+s\d+$/,
            /^eno\d+$/,
            /^wlan\d+$/,
            /^wlp\d+s\d+$/
        ];

        return localPatterns.some(pattern => pattern.test(name));
    }

    // Calcule l'adresse broadcast
    calculateBroadcast(ip, netmask) {
        const ipParts = ip.split('.').map(Number);
        const maskParts = netmask.split('.').map(Number);
        const broadcast = ipParts.map((octet, i) => 
            octet | (~maskParts[i] & 255)
        );
        return broadcast.join('.');
    }

    // Auto-détection intelligente
    autoDetect() {
        console.log('🔍 Démarrage de l\'auto-détection des interfaces...');
        
        this.allInterfaces = this.detectAllInterfaces();

        console.log(`\n📡 ${this.allInterfaces.length} interface(s) détectée(s):`);
        this.allInterfaces.forEach(iface => {
            console.log(`  - ${iface.name}: ${iface.address} (Docker: ${iface.isDocker}, Local: ${iface.isLocal})`);
        });

        // Sélection automatique de l'interface locale
        if (!this.localInterface) {
            const localCandidates = this.allInterfaces.filter(i => i.isLocal && !i.isDocker);
            
            if (localCandidates.length > 0) {
                // Prioriser les interfaces "eth" puis "ens"
                this.localInterface = localCandidates.find(i => i.name.startsWith('eth')) ||
                                     localCandidates.find(i => i.name.startsWith('ens')) ||
                                     localCandidates[0];
                
                console.log(`\n✅ Interface LOCALE détectée: ${this.localInterface.name} (${this.localInterface.address})`);
            } else {
                console.warn('\n⚠️  Aucune interface locale détectée automatiquement');
            }
        }

        // Sélection automatique de l'interface Docker
        if (!this.dockerInterface) {
            const dockerCandidates = this.allInterfaces.filter(i => i.isDocker);
            
            if (dockerCandidates.length > 0) {
                // Prioriser "docker0"
                this.dockerInterface = dockerCandidates.find(i => i.name === 'docker0') ||
                                      dockerCandidates[0];
                
                console.log(`✅ Interface DOCKER détectée: ${this.dockerInterface.name} (${this.dockerInterface.address})`);
            } else {
                console.warn('⚠️  Aucune interface Docker détectée');
            }
        }

        // Sauvegarder la configuration
        this.saveConfig();

        return {
            local: this.localInterface,
            docker: this.dockerInterface,
            all: this.allInterfaces
        };
    }

    // Charge une interface spécifique par nom
    loadInterfaceByName(name) {
        const iface = this.allInterfaces.find(i => i.name === name);
        if (!iface) {
            throw new Error(`Interface ${name} non trouvée`);
        }
        return iface;
    }

    // Initialise la configuration
    initialize() {
        // Si interfaces spécifiées manuellement
        if (LOCAL_INTERFACE || DOCKER_INTERFACE) {
            console.log('📝 Configuration manuelle détectée');
            
            this.allInterfaces = this.detectAllInterfaces();

            if (LOCAL_INTERFACE) {
                try {
                    this.localInterface = this.loadInterfaceByName(LOCAL_INTERFACE);
                    console.log(`✅ Interface locale configurée: ${LOCAL_INTERFACE}`);
                } catch (err) {
                    console.error(`❌ Erreur: ${err.message}`);
                }
            }

            if (DOCKER_INTERFACE) {
                try {
                    this.dockerInterface = this.loadInterfaceByName(DOCKER_INTERFACE);
                    console.log(`✅ Interface Docker configurée: ${DOCKER_INTERFACE}`);
                } catch (err) {
                    console.error(`❌ Erreur: ${err.message}`);
                }
            }
        }

        // Auto-détection si activée et interfaces non configurées
        if (AUTO_DETECT && (!this.localInterface || !this.dockerInterface)) {
            this.autoDetect();
        }

        // Charger depuis le fichier de config si disponible
        if (!this.localInterface || !this.dockerInterface) {
            this.loadConfig();
        }

        return this;
    }

    // Sauvegarde la configuration
    saveConfig() {
        const config = {
            timestamp: new Date().toISOString(),
            local: this.localInterface ? {
                name: this.localInterface.name,
                address: this.localInterface.address
            } : null,
            docker: this.dockerInterface ? {
                name: this.dockerInterface.name,
                address: this.dockerInterface.address
            } : null,
            all: this.allInterfaces.map(i => ({
                name: i.name,
                address: i.address,
                isDocker: i.isDocker,
                isLocal: i.isLocal
            }))
        };

        try {
            fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
            console.log(`\n💾 Configuration sauvegardée dans ${this.configPath}`);
        } catch (err) {
            console.error('Erreur lors de la sauvegarde:', err.message);
        }
    }

    // Charge la configuration depuis le fichier
    loadConfig() {
        if (!fs.existsSync(this.configPath)) {
            return false;
        }

        try {
            const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            console.log(`\n📂 Configuration chargée depuis ${this.configPath}`);

            if (config.local && !this.localInterface) {
                this.localInterface = this.loadInterfaceByName(config.local.name);
            }

            if (config.docker && !this.dockerInterface) {
                this.dockerInterface = this.loadInterfaceByName(config.docker.name);
            }

            return true;
        } catch (err) {
            console.error('Erreur lors du chargement:', err.message);
            return false;
        }
    }

    // Obtient une interface par type
    getInterface(type) {
        if (type === 'local') return this.localInterface;
        if (type === 'docker') return this.dockerInterface;
        return null;
    }
}

// Instance globale de la configuration réseau
const networkConfig = new NetworkConfig().initialize();

// Fonction pour créer le Magic Packet WOL
function createMagicPacket(macAddress) {
    const mac = macAddress.replace(/[:-]/g, '').toLowerCase();
    
    if (mac.length !== 12) {
        throw new Error('Adresse MAC invalide');
    }
    
    const macBuffer = Buffer.from(mac, 'hex');
    const magicPacket = Buffer.alloc(102);
    
    for (let i = 0; i < 6; i++) {
        magicPacket[i] = 0xFF;
    }
    
    for (let i = 0; i < 16; i++) {
        macBuffer.copy(magicPacket, 6 + i * 6);
    }
    
    return magicPacket;
}

// Fonction pour envoyer le WOL sur une interface spécifique
function sendWOL(macAddress, interfaceConfig, callback) {
    if (!interfaceConfig) {
        return callback(new Error('Interface non configurée'));
    }

    const { name, address, broadcast } = interfaceConfig;
    
    console.log(`📤 Envoi WOL sur ${name}:`);
    console.log(`   Source: ${address}`);
    console.log(`   Broadcast: ${broadcast}`);
    console.log(`   MAC: ${macAddress}`);
    
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    
    socket.bind(0, address, () => {
        socket.setBroadcast(true);
        
        try {
            const magicPacket = createMagicPacket(macAddress);
            
            socket.send(magicPacket, 0, magicPacket.length, WOL_PORT, broadcast, (err) => {
                socket.close();
                
                if (err) {
                    console.error(`❌ Erreur sur ${name}:`, err.message);
                    callback(err);
                } else {
                    console.log(`✅ WOL envoyé avec succès sur ${name}`);
                    callback(null);
                }
            });
        } catch (err) {
            socket.close();
            callback(err);
        }
    });
    
    socket.on('error', (err) => {
        console.error(`❌ Erreur socket sur ${name}:`, err.message);
        socket.close();
        callback(err);
    });
}

// Middleware d'authentification
function authenticate(req, res, next) {
    if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
        return res.status(401).json({ error: 'Non autorisé' });
    }
    next();
}

// Route de santé
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        autoDetect: AUTO_DETECT,
        interfaces: {
            local: networkConfig.localInterface ? {
                name: networkConfig.localInterface.name,
                ip: networkConfig.localInterface.address,
                broadcast: networkConfig.localInterface.broadcast
            } : null,
            docker: networkConfig.dockerInterface ? {
                name: networkConfig.dockerInterface.name,
                ip: networkConfig.dockerInterface.address,
                broadcast: networkConfig.dockerInterface.broadcast
            } : null
        },
        allInterfaces: networkConfig.allInterfaces.length
    });
});

// Route pour lister toutes les interfaces
app.get('/interfaces', authenticate, (req, res) => {
    res.json({
        configured: {
            local: networkConfig.localInterface,
            docker: networkConfig.dockerInterface
        },
        all: networkConfig.allInterfaces
    });
});

// Route pour re-détecter les interfaces
app.post('/interfaces/detect', authenticate, (req, res) => {
    try {
        const result = networkConfig.autoDetect();
        res.json({
            success: true,
            message: 'Re-détection effectuée',
            result
        });
    } catch (err) {
        res.status(500).json({
            error: 'Erreur lors de la détection',
            details: err.message
        });
    }
});

// Route pour envoyer le WOL
app.post('/wake', authenticate, (req, res) => {
    const { mac, interface: targetInterface } = req.body;
    
    if (!mac) {
        return res.status(400).json({ error: 'Adresse MAC requise' });
    }
    
    let interfaceConfig;
    
    if (targetInterface) {
        // Interface spécifiée
        if (targetInterface === 'local') {
            interfaceConfig = networkConfig.localInterface;
        } else if (targetInterface === 'docker') {
            interfaceConfig = networkConfig.dockerInterface;
        } else {
            // Recherche par nom
            interfaceConfig = networkConfig.allInterfaces.find(
                i => i.name === targetInterface
            );
        }
    } else {
        // Par défaut, interface locale
        interfaceConfig = networkConfig.localInterface;
    }
    
    if (!interfaceConfig) {
        return res.status(404).json({ 
            error: 'Interface non trouvée ou non configurée',
            requested: targetInterface || 'local'
        });
    }
    
    sendWOL(mac, interfaceConfig, (err) => {
        if (err) {
            return res.status(500).json({ 
                error: 'Échec envoi WOL', 
                details: err.message 
            });
        }
        
        res.json({ 
            success: true, 
            message: `WOL envoyé à ${mac} via ${interfaceConfig.name}`,
            interface: interfaceConfig.name
        });
    });
});

// Route pour envoyer sur les deux interfaces
app.post('/wake-all', authenticate, (req, res) => {
    const { mac } = req.body;
    
    if (!mac) {
        return res.status(400).json({ error: 'Adresse MAC requise' });
    }
    
    const results = {
        local: { 
            success: false, 
            interface: networkConfig.localInterface?.name || 'non configurée'
        },
        docker: { 
            success: false, 
            interface: networkConfig.dockerInterface?.name || 'non configurée'
        }
    };
    
    let completed = 0;
    const total = 2;
    
    function checkComplete() {
        completed++;
        if (completed === total) {
            const allSuccess = results.local.success || results.docker.success;
            res.status(allSuccess ? 200 : 500).json({
                success: allSuccess,
                results
            });
        }
    }
    
    // Envoi sur interface locale
    if (networkConfig.localInterface) {
        sendWOL(mac, networkConfig.localInterface, (err) => {
            results.local.success = !err;
            if (err) results.local.error = err.message;
            checkComplete();
        });
    } else {
        results.local.error = 'Interface locale non configurée';
        checkComplete();
    }
    
    // Envoi sur interface Docker
    if (networkConfig.dockerInterface) {
        sendWOL(mac, networkConfig.dockerInterface, (err) => {
            results.docker.success = !err;
            if (err) results.docker.error = err.message;
            checkComplete();
        });
    } else {
        results.docker.error = 'Interface Docker non configurée';
        checkComplete();
    }
});

// Démarrage du serveur
app.listen(SERVER_PORT, SERVER_IP, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 Serveur Wake-on-LAN démarré');
    console.log('='.repeat(60));
    console.log(`📍 Écoute sur: ${SERVER_IP}:${SERVER_PORT}`);
    console.log(`🔐 API Key: ${API_KEY ? '***configurée***' : '⚠️  NON CONFIGURÉE'}`);
    console.log(`🔍 Auto-détection: ${AUTO_DETECT ? '✅ Activée' : '❌ Désactivée'}`);
    console.log(`📡 WOL Port: ${WOL_PORT}`);
    
    if (networkConfig.localInterface) {
        console.log(`\n🏠 Interface LOCALE:`);
        console.log(`   Nom: ${networkConfig.localInterface.name}`);
        console.log(`   IP: ${networkConfig.localInterface.address}`);
        console.log(`   Broadcast: ${networkConfig.localInterface.broadcast}`);
    } else {
        console.log(`\n⚠️  Interface LOCALE: Non configurée`);
    }
    
    if (networkConfig.dockerInterface) {
        console.log(`\n🐳 Interface DOCKER:`);
        console.log(`   Nom: ${networkConfig.dockerInterface.name}`);
        console.log(`   IP: ${networkConfig.dockerInterface.address}`);
        console.log(`   Broadcast: ${networkConfig.dockerInterface.broadcast}`);
    } else {
        console.log(`\n⚠️  Interface DOCKER: Non configurée`);
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
});