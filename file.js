// Configurație API - UPDATED
const API_CONFIG = {
    sendMessage: "https://prod-56.northeurope.logic.azure.com:443/workflows/f5d9b06f30b44c5baf84d32c7bdaa829/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=9vBMtmwPhzriKt6gnVjfTvd9aCI5E-oGDqwzkhUhMPU",
    sendTemplateMessageUrl: "https://prod-29.northeurope.logic.azure.com:443/workflows/3f95b591c2f24563a48b0e28ee08703f/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=UCl9ofQ72azg1rx_GycOZxzXXwE5DNG_twpJ-qbYiko",
    refreshInterval: 15000,
    messageCheckInterval: 5000,
    messagesPageSize: 50,
    TOP_MESSAGE_RECORDS_TO_FETCH: 5000
};

// Lead Status Mapping
const LEAD_STATUS_MAPPING = {
    '100000002': 'standby',
    '100000006': 'eligible',
    '100000004': 'asignat-la-superior',
    '100000003': 'rejected',
    '100000007': 'in-executare',
    '100000008': 'nu-raspunde',
    '100000010': 'de-revenit',
    '100000011': 'contract',
    '100000012': 'test',
    '100000013': 'dezinteresati',
    '100000001': 'client-nou'
};

const LEAD_STATUS_LABELS = {
    'standby': 'Standby',
    'eligible': 'Eligible',
    'asignat-la-superior': 'Asignat la Superior',
    'rejected': 'Rejected',
    'in-executare': 'In Executare',
    'nu-raspunde': 'Nu Raspunde',
    'de-revenit': 'De Revenit',
    'contract': 'Contract',
    'test': 'Test',
    'dezinteresati': 'Dezinteresati',
    'client-nou': 'Client nou'
};

// Direction mapping for messages
const DIRECTION_MAPPING = {
    'incoming': 1,
    'outgoing': 2
};

// AGENT PERMISSIONS AND SETTINGS
const AgentPermissions = {
    default: {
        canViewOwnConversations: true,
        canViewUnassigned: true,
        canClaimUnassigned: true,
        canTransferOwn: true,
        canViewAllConversations: false,
        maxActiveConversations: 20
    },
    supervisor: {
        canViewOwnConversations: true,
        canViewUnassigned: true,
        canClaimUnassigned: true,
        canTransferOwn: true,
        canViewAllConversations: true,
        canReassignAny: true,
        canViewAgentStats: true,
        maxActiveConversations: null // No limit
    }
};

// DEFINE THESE VARIABLES FIRST
let AGENTS = [];
let CURRENT_USER = null;
let USER_PERMISSIONS = {};

// Function to get current user from Dynamics 365
async function getCurrentUser() {
    try {
        // Verificăm mai multe căi pentru a accesa Dynamics context
        let globalContext = null;
        
        // Încercăm mai multe modalități de a accesa contextul
        if (window.parent?.Xrm?.Utility?.getGlobalContext) {
            globalContext = window.parent.Xrm.Utility.getGlobalContext();
        } else if (window.Xrm?.Utility?.getGlobalContext) {
            globalContext = window.Xrm.Utility.getGlobalContext();
        } else if (parent?.Xrm?.Page?.context) {
            // Pentru versiuni mai vechi de Dynamics
            globalContext = parent.Xrm.Page.context;
        }
        
        if (globalContext && globalContext.userSettings) {
            const userSettings = globalContext.userSettings;
            
            // Obținem ID-ul și curățăm GUID-ul
            const userId = userSettings.userId.replace(/[{}]/g, '');
            
            CURRENT_USER = {
                id: userId,
                name: userSettings.userName,
                email: userSettings.userEmail || '',
                initials: Utils.getInitials(userSettings.userName),
                isSupervisor: false
            };
            
            console.log('🔍 Verificăm rolurile pentru:', CURRENT_USER.name, userId);
            
            // Corect: întâi iau roleid-urile, apoi numele rolurilor
            try {
                // 1. Ia toate roleid pentru user
                const userRoles = await window.parent.Xrm.WebApi.retrieveMultipleRecords(
                    "systemuserroles",
                    `?$select=roleid&$filter=systemuserid eq '${userId}'`
                );
                let roleNames = [];
                if (userRoles && userRoles.entities && userRoles.entities.length > 0) {
                    // 2. Pentru fiecare roleid, ia numele rolului
                    const roleIdList = userRoles.entities.map(e => e.roleid).filter(Boolean);
                    if (roleIdList.length > 0) {
                        // Interogare paralelă pentru fiecare roleid
                        const rolePromises = roleIdList.map(roleid =>
                            window.parent.Xrm.WebApi.retrieveRecord("role", roleid, "?$select=name")
                                .then(role => role && role.name)
                                .catch(() => null)
                        );
                        roleNames = (await Promise.all(rolePromises)).filter(Boolean);
                        console.log(`📋 Roluri găsite (corect):`, roleNames);
                        const hasAdminRole = roleNames.some(roleName => {
                            const rn = roleName.toLowerCase();
                            return rn.includes('administrator') || rn.includes('admin') || rn.includes('system administrator');
                        });
                        CURRENT_USER.isSupervisor = hasAdminRole;
                    }
                }
            } catch (roleError) {
                console.warn('⚠️ Eroare la obținerea rolurilor prin systemuserroles:', roleError);
                // Alternativă: verificăm direct security roles ale utilizatorului
                try {
                    const userRecord = await window.parent.Xrm.WebApi.retrieveRecord(
                        "systemuser", 
                        userId,
                        "?$select=fullname&$expand=systemuserroles_association($select=name)"
                    );
                    if (userRecord.systemuserroles_association) {
                        const roleNames = userRecord.systemuserroles_association.map(r => r.name);
                        console.log(`📋 Roluri găsite (alternativ):`, roleNames);
                        const hasAdminRole = userRecord.systemuserroles_association.some(role => {
                            const roleName = role.name?.toLowerCase() || '';
                            return roleName.includes('administrator') || 
                                   roleName.includes('admin');
                        });
                        CURRENT_USER.isSupervisor = hasAdminRole;
                    }
                } catch (altError) {
                    console.warn('⚠️ Nu s-au putut verifica rolurile (alternativ):', altError);
                    // Presupunem că este agent normal
                    CURRENT_USER.isSupervisor = false;
                }
            }
            
            // Setăm permisiunile
            USER_PERMISSIONS = CURRENT_USER.isSupervisor ? 
                AgentPermissions.supervisor : 
                AgentPermissions.default;
            
            console.log('✅ Utilizator încărcat cu succes:', {
                name: CURRENT_USER.name,
                id: CURRENT_USER.id,
                email: CURRENT_USER.email,
                isSupervisor: CURRENT_USER.isSupervisor,
                permissions: CURRENT_USER.isSupervisor ? 'Supervisor' : 'Agent'
            });
            
            return CURRENT_USER;
        }
        
        throw new Error('Context Dynamics 365 nu este disponibil');
        
    } catch (error) {
        console.error('❌ Eroare la obținerea utilizatorului curent:', error);
        
        // Fallback doar dacă chiar nu avem altă opțiune
        if (!CURRENT_USER || !CURRENT_USER.id) {
            console.warn('⚠️ Se folosește utilizator fallback pentru dezvoltare');
            CURRENT_USER = {
                id: 'current-user-id',
                name: 'Agent Test',
                email: 'agent@imfs.ro',
                initials: 'AT',
                isSupervisor: false
            };
            USER_PERMISSIONS = AgentPermissions.default;
        }
        
        return CURRENT_USER;
    }
}

// Function to load available agents from Dynamics 365
async function loadAvailableAgents() {
    try {
        if (!window.parent?.Xrm?.WebApi) {
            throw new Error('Xrm.WebApi nu este disponibil');
        }
        const userFetchXml = `
            <fetch version="1.0" output-format="xml-platform" mapping="logical" top="50">
                <entity name="systemuser">
                    <attribute name="systemuserid" />
                    <attribute name="fullname" />
                    <attribute name="internalemailaddress" />
                    <filter type="and">
                        <condition attribute="isdisabled" operator="eq" value="false" />
                        <condition attribute="accessmode" operator="eq" value="0" />
                    </filter>
                    <order attribute="fullname" ascending="true" />
                </entity>
            </fetch>`;
        const result = await window.parent.Xrm.WebApi.retrieveMultipleRecords(
            "systemuser", 
            "?fetchXml=" + encodeURIComponent(userFetchXml)
        );
        AGENTS.length = 0;
        result.entities.forEach(user => {
            AGENTS.push({
                id: user.systemuserid,
                name: user.fullname || 'Nume necunoscut',
                email: user.internalemailaddress || '',
                status: 'online',
                initials: Utils.getInitials(user.fullname || 'NN')
            });
        });
        console.log(`👥 ${AGENTS.length} agenți încărcați din Dynamics 365`);
        
        if (AGENTS.length === 0) {
            console.warn('Nu s-au încărcat agenți din Dynamics. Se folosește fallback.');
            AGENTS.push(
                { id: 'agent1', name: 'Ana Popescu', email: 'ana.popescu@imfs.ro', status: 'online', initials: 'AP' },
                { id: 'agent2', name: 'Mihai Ionescu', email: 'mihai.ionescu@imfs.ro', status: 'online', initials: 'MI' },
                { id: 'agent3', name: 'Elena Georgescu', email: 'elena.georgescu@imfs.ro', status: 'busy', initials: 'EG' }
            );
        }
        return AGENTS;
    } catch (error) {
        console.error('Eroare la încărcarea agenților:', error);
        // Fallback pentru dezvoltare
        AGENTS.length = 0;
        AGENTS.push(
            { id: 'agent1', name: 'Ana Popescu', email: 'ana.popescu@imfs.ro', status: 'online', initials: 'AP' },
            { id: 'agent2', name: 'Mihai Ionescu', email: 'mihai.ionescu@imfs.ro', status: 'online', initials: 'MI' },
            { id: 'agent3', name: 'Elena Georgescu', email: 'elena.georgescu@imfs.ro', status: 'busy', initials: 'EG' }
        );
        return AGENTS;
    }
}

// State Management - UPDATED FOR AGENT VIEW
class WhatsAppState {
    constructor() {
        this.conversations = [];
        this.messages = {};
        this.messagePagination = {}; // Pentru paginarea mesajelor
        this.currentConversation = null;
        this.viewMode = 'my-conversations'; // 'my-conversations' | 'available' | 'all'
        this.filters = {
            search: '',
            category: 'all',
            leadCategory: 'all',
            agent: 'all'
        };
        this.settings = {
            notifications: true,
            sounds: true,
            refreshInterval: 15000,
            messageCheckInterval: 5000,
            autoClaimNew: false,
            maxActiveConversations: 20
        };
        this.agents = [];
        this.currentUser = null;
        this.pagination = {
            currentPage: 1,
            pageSize: 200, // Am mărit numărul de lead-uri încărcate pe pagină
            hasMore: true,
            isLoading: false,
            totalLoaded: 0
        };
        this.conversationStats = {
            myActive: 0,
            myUnread: 0,
            available: 0,
            completedToday: 0
        };
        this.lastMessageCheck = new Date(Date.now() - 60000).toISOString();
        this.loadSettings();
    }

    addConversations(newConversations) {
        if (!Array.isArray(newConversations) || newConversations.length === 0) {
            return;
        }
    
        const existingConversationIds = new Set(this.conversations.map(c => c.id));
    
        const uniqueNewConversations = newConversations.filter(
            c => !existingConversationIds.has(c.id)
        );
    
        if (uniqueNewConversations.length > 0) {
            this.conversations.push(...uniqueNewConversations);
            // Sortarea se face după ce se adaugă, pentru a menține ordinea cronologică corectă
            this.conversations.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
        }
    }

    loadSettings() {
        const saved = localStorage.getItem('whatsapp_settings');
        if (saved) {
            this.settings = { ...this.settings, ...JSON.parse(saved) };
        }
    }

    saveSettings() {
        localStorage.setItem('whatsapp_settings', JSON.stringify(this.settings));
    }

    updateStats() {
        const isSupervisor = this.currentUser?.isSupervisor;

        // Filtru pentru conversații care nu sunt "finalizate"
        const activeConversationsFilter = c => !['contract', 'dezinteresati', 'rejected'].includes(Utils.getLeadStatusFromValue(c.status));

        // Filtru pentru conversații finalizate "astăzi"
        const completedTodayFilter = c => {
            const status = Utils.getLeadStatusFromValue(c.status);
            const isCompleted = ['contract', 'dezinteresati'].includes(status);
            if (!isCompleted) return false;
            const lastActivityDate = new Date(c.lastActivity);
            const today = new Date();
            return lastActivityDate.getDate() === today.getDate() &&
                   lastActivityDate.getMonth() === today.getMonth() &&
                   lastActivityDate.getFullYear() === today.getFullYear();
        };

        if (isSupervisor) {
            // --- STATISTICI GLOBALE PENTRU SUPERVISOR ---
            this.conversationStats = {
                // Toate conversațiile atribuite și active
                myActive: this.conversations.filter(c => c.assignedAgent && activeConversationsFilter(c)).length,
                // Toate conversațiile cu mesaje necitite
                myUnread: this.conversations.filter(c => c.unreadCount > 0).length,
                // Toate conversațiile neatribuite
                available: this.conversations.filter(c => !c.assignedAgent).length,
                // Toate conversațiile finalizate astăzi
                completedToday: this.conversations.filter(completedTodayFilter).length
            };
        } else {
            // --- STATISTICI PERSONALE PENTRU AGENT ---
            const agentId = this.currentUser?.id;
            this.conversationStats = {
                // Conversațiile active ale agentului curent
                myActive: this.conversations.filter(c => c.assignedAgent === agentId && activeConversationsFilter(c)).length,
                // Conversațiile necitite ale agentului curent
                myUnread: this.conversations.filter(c => c.assignedAgent === agentId && c.unreadCount > 0).length,
                // Toate conversațiile neatribuite (vizibile pentru toți)
                available: this.conversations.filter(c => !c.assignedAgent).length,
                // Conversațiile finalizate astăzi de agentul curent
                completedToday: this.conversations.filter(c => c.assignedAgent === agentId && completedTodayFilter(c)).length
            };
        }
    }
}

// Utility Functions
const Utils = {
    debounce(func, delay) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, delay);
        };
    },

    truncateText(text, maxLength = 60) {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    },

    getInitials(name) {
        if (!name) return '??';
        name = name.trim().replace(/\s+/g, ' ');
        const parts = name.split(' ');
        let initials = '';
        
        if (parts.length === 1) {
            initials = parts[0].substring(0, 2).toUpperCase();
        } else {
            for (let i = 0; i < parts.length && initials.length < 2; i++) {
                if (parts[i].length > 0) {
                    initials += parts[i][0].toUpperCase();
                }
            }
        }
        return initials || '??';
    },

    normalizeId(id) {
        if (!id) return '';
        return id.toString().replace(/[{}]/g, '').toLowerCase();
    },

    linkify(text) {
        const urlRegex = /(?<!href=")(https?:\/\/[^\s<]+)/g;
        const escapedText = $('<div>').text(text).html();

        const content = escapedText.replace(urlRegex, (url) => {
            const decodedUrl = $('<div>').html(url).text();
            
            if (Utils.isImageUrl(decodedUrl)) {
                return `
                    <div class="attachment">
                        <img src="${decodedUrl}" alt="Imagine atașată" class="attachment-image" 
                             data-src="${decodedUrl}" loading="lazy"
                             style="cursor: pointer;"
                             onerror="this.onerror=null; this.alt='Imagine indisponibilă'; this.classList.add('image-error'); this.style.cursor='default';">
                    </div>`;
            } else if (Utils.isPdfUrl(decodedUrl)) {
                const fileName = decodeURIComponent(decodedUrl.split('/').pop().split('?')[0]);
                return `
                    <div class="attachment">
                        <a href="${decodedUrl}" target="_blank" rel="noopener noreferrer" class="attachment-pdf" 
                           title="Deschide PDF: ${fileName}">
                            <i class="fas fa-file-pdf"></i>
                            <span>${Utils.truncateText(fileName, 30)}</span>
                            <i class="fas fa-external-link-alt ms-2"></i>
                        </a>
                    </div>`;
            } else {
                const videoExtensions = /\.(mp4|webm|ogg|mov|avi)(?:[?#]|$)/i;
                const audioExtensions = /\.(mp3|wav|ogg|m4a)(?:[?#]|$)/i;
                
                if (videoExtensions.test(decodedUrl)) {
                    return `
                        <div class="attachment">
                            <video controls class="attachment-video" style="max-width: 100%; max-height: 300px;">
                                <source src="${decodedUrl}" type="video/mp4">
                                Browser-ul dvs. nu suportă redarea video.
                            </video>
                        </div>`;
                } else if (audioExtensions.test(decodedUrl)) {
                    return `
                        <div class="attachment">
                            <audio controls class="attachment-audio">
                                <source src="${decodedUrl}" type="audio/mpeg">
                                Browser-ul dvs. nu suportă redarea audio.
                            </audio>
                        </div>`;
                } else {
                    const displayUrl = Utils.truncateText(decodedUrl, 50);
                    return `<a href="${decodedUrl}" target="_blank" rel="noopener noreferrer" 
                              title="${decodedUrl}">${displayUrl}</a>`;
                }
            }
        });
        
        return `<p>${content.replace(/\n/g, '<br>')}</p>`;
    },
    
    formatTime(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        const now = new Date();
        const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) {
            return date.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            return 'Ieri';
        } else if (diffDays < 7) {
            return date.toLocaleDateString('ro-RO', { weekday: 'long' });
        } else {
            return date.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' });
        }
    },

    getLeadStatusFromValue(value) {
        return LEAD_STATUS_MAPPING[value] || 'standby';
    },

    getLeadStatusLabel(status) {
        return LEAD_STATUS_LABELS[status] || 'Standby';
    },

    isImageUrl(url) {
        if (typeof url !== 'string') return false;
        
        if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:image')) {
            return false;
        }
        
        const imageExtensions = /\.(jpeg|jpg|gif|png|webp|bmp|svg)(?:[?#]|$)/i;
        if (imageExtensions.test(url)) {
            return true;
        }
        
        const mediaPatterns = [
            /media[\.-].*\.whatsapp\.net/i,
            /media\.fmessenger\.com/i,
            /scontent.*\.fbcdn\.net/i,
            /\/media\//i,
            /cloudinary\.com/i,
            /imgbb\.com/i,
            /imgur\.com/i
        ];
        
        return mediaPatterns.some(pattern => pattern.test(url));
    },
    
    isPdfUrl(url) {
        if (typeof url !== 'string') return false;
        
        const pdfRegex = /\.pdf(?:[?#]|$)/i;
        if (pdfRegex.test(url)) {
            return true;
        }
        
        const pdfPatterns = [
            /[?&]type=pdf/i,
            /[?&]format=pdf/i,
            /\/pdf\//i,
            /download.*pdf/i
        ];
        
        return pdfPatterns.some(pattern => pattern.test(url));
    },

    formatDate(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('ro-RO', { 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit' 
        });
    },

    formatCurrency(amount) {
        if (!amount && amount !== 0) return '';
        return new Intl.NumberFormat('ro-RO', {
            style: 'currency',
            currency: 'RON',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount);
    }
};

// --- START TEMPLATE CONFIG ---
const MESSAGE_TEMPLATES = [
    {
        name: "documente_necesare_prima_rata",
        displayName: "Documente necesare (prima rată)",
        body: "Buna ziua, {{1}}! Pentru a putea continua cu analiza dosarului dvs. de credit, avem nevoie de urmatoarele documente: extras de cont pe ultimele 3 luni, adeverinta de venit si copie dupa cartea de identitate. Daca aveti contract de munca in strainatate, va rugam sa ne trimiteti si contractul de munca tradus si legalizat. In cazul in care ati avut prima rata la un credit in ultimele 6 luni, va rugam sa ne trimiteti si dovada platii acesteia. O zi buna!",
        params: ["Nume Client"]
    },
    {
        name: "informatii_suplimentare",
        displayName: "Informații suplimentare",
        body: "Buna ziua, {{1}}! Pentru a finaliza analiza, va rugam sa ne furnizati urmatoarele informatii: {{2}}. Va multumim!",
        params: ["Nume Client", "Informații solicitate"]
    },
    {
        name: "oferta_preaprobata",
        displayName: "Ofertă pre-aprobată",
        body: "Buna ziua, {{1}}! Avem vesti bune! Dosarul dumneavoastra a fost pre-aprobat pentru un credit in valoare de {{2}} RON. Va rugam sa ne contactati pentru a stabili urmatorii pasi.",
        params: ["Nume Client", "Suma pre-aprobată"]
    },
    {
        name: "memento_documente",
        displayName: "Memento documente",
        body: "Buna ziua, {{1}}! Va reamintim ca asteptam documentele solicitate pentru a putea continua analiza dosarului dumneavoastra. O zi frumoasa!",
        params: ["Nume Client"]
    },
     {
        name: "notificare_inactivitate",
        displayName: "Notificare inactivitate",
        body: "Buna ziua, {{1}}! Observam ca nu am mai primit un raspuns de la dumneavoastra. Daca mai sunteti interesat(a) de serviciile noastre, va rugam sa ne anuntati. In caz contrar, vom considera solicitarea inchisa in 48 de ore. Va multumim!",
        params: ["Nume Client"]
    }
];
// --- END TEMPLATE CONFIG ---

// API Service - UPDATED FOR AGENT-SPECIFIC QUERIES
class APIService {
    // --- AM RESCRIS COMPLET ACEASTĂ FUNCȚIE FOLOSIND LOGICA CORECTĂ DIN VECHI.JS ---
    static async loadConversations(viewMode = 'my-conversations', leadCategoryFilter = 'all', page = 1, pageSize = 200, agentFilter = 'all') {
        try {
            if (!window.parent?.Xrm?.WebApi) throw new Error('Xrm.WebApi nu este disponibil');
            if (!CURRENT_USER) throw new Error('Utilizatorul curent nu este încărcat.');

            console.log(`--- Pornire Încărcare Conversații (Logica Corectă v3) ---
                ViewMode: ${viewMode}, Filtru Status: ${leadCategoryFilter}, Filtru Agent: ${agentFilter}, Pagina: ${page}`);

            // Pas 1: Aducem un număr mare de mesaje recente, incluzând direcția
            const messageFetchXml = `
                <fetch top="${API_CONFIG.TOP_MESSAGE_RECORDS_TO_FETCH}" no-lock="true">
                    <entity name="new_new_whatsappconversation">
                        <attribute name="new_leadid" />
                        <attribute name="new_timestamp" />
                        <attribute name="new_message" />
                        <attribute name="new_direction" />
                        <order attribute="new_timestamp" descending="true" />
                        <filter type="and"><condition attribute="new_leadid" operator="not-null" /></filter>
                    </entity>
                </fetch>`;
            
            const messageResults = await window.parent.Xrm.WebApi.retrieveMultipleRecords("new_new_whatsappconversation", "?fetchXml=" + encodeURIComponent(messageFetchXml));

            // Pas 2: Grupăm mesajele după leadId și agregăm datele corect
            const aggregatedLeadData = new Map();
            messageResults.entities.forEach(msg => {
                const leadId = msg["_new_leadid_value"];
                if (!leadId) return;

                // Prima oară când vedem un lead, stocăm ultima sa activitate generală
                if (!aggregatedLeadData.has(leadId)) {
                    aggregatedLeadData.set(leadId, {
                        lastActivity: msg.new_timestamp,
                        lastMessage: msg.new_message,
                        lastIncomingMessageTimestamp: null
                    });
                }
                
                const leadData = aggregatedLeadData.get(leadId);

                // Căutăm primul mesaj de la client (direcția 1) și stocăm timestamp-ul lui.
                // Deoarece mesajele sunt sortate descrescător, primul găsit va fi cel mai recent.
                if (msg.new_direction === 1 && leadData.lastIncomingMessageTimestamp === null) {
                    leadData.lastIncomingMessageTimestamp = msg.new_timestamp;
                }
            });

            if (aggregatedLeadData.size === 0) return { conversations: [], hasMore: false };

            // --- FIX PENTRU EROAREA "URI TOO LONG" ---
            // Pas 3: Aducem detaliile lead-urilor în loturi (batch-uri)
            const leadIds = Array.from(aggregatedLeadData.keys());
            const allLeadDetails = [];
            const batchSize = 100; // Procesăm în loturi de 100 pentru a evita URL-uri prea lungi

            for (let i = 0; i < leadIds.length; i += batchSize) {
                const batchLeadIds = leadIds.slice(i, i + batchSize);
                const leadFilterConditions = batchLeadIds.map(id => `<condition attribute="leadid" operator="eq" value="${id}" />`).join('');
                
                const leadFetchXml = `
                    <fetch no-lock="true">
                        <entity name="lead">
                            <attribute name="leadid" /><attribute name="fullname" /><attribute name="telephone1" />
                            <attribute name="new_leadstatus" /><attribute name="ownerid" /><attribute name="new_businessunit" />
                            <attribute name="modifiedon" />
                            <link-entity name="systemuser" from="systemuserid" to="ownerid" alias="owner" link-type="outer"><attribute name="fullname" /></link-entity>
                            <link-entity name="businessunit" from="businessunitid" to="new_businessunit" alias="bu" link-type="outer"><attribute name="name" /></link-entity>
                            <filter type="or">${leadFilterConditions}</filter>
                        </entity>
                    </fetch>`;
                
                const batchResults = await window.parent.Xrm.WebApi.retrieveMultipleRecords("lead", "?fetchXml=" + encodeURIComponent(leadFetchXml));
                allLeadDetails.push(...batchResults.entities);
            }

            // Pas 4: Aducem numărul de mesaje necitite (acesta poate rămâne într-un singur apel)
            const unreadCounts = new Map();
            const unreadFetchXml = `
                <fetch aggregate="true" no-lock="true">
                    <entity name="new_new_whatsappconversation">
                        <attribute name="new_leadid" alias="lead" groupby="true" />
                        <attribute name="new_new_whatsappconversationid" alias="count" aggregate="count" />
                        <filter type="and">
                            <condition attribute="new_messageread" operator="eq" value="false" />
                            <condition attribute="new_direction" operator="eq" value="1" />
                        </filter>
                    </entity>
                </fetch>`;
            const unreadResults = await window.parent.Xrm.WebApi.retrieveMultipleRecords("new_new_whatsappconversation", "?fetchXml=" + encodeURIComponent(unreadFetchXml));
            unreadResults.entities.forEach(r => unreadCounts.set(r.lead, r.count));

            // Pas 5: Construim lista finală de conversații, incluzând data corectă
            let finalConversations = allLeadDetails.map(lead => {
                const aggregatedData = aggregatedLeadData.get(lead.leadid);
                const unreadCount = unreadCounts.get(lead.leadid) || 0;

                // Safety check pentru lead-urile care nu au mesaje în setul inițial
                if (!aggregatedData) {
                    return {
                        id: lead.leadid, name: lead.fullname || "N/A", phone: lead.telephone1, status: lead.new_leadstatus,
                        assignedAgent: lead["_ownerid_value"], ownerName: lead["owner.fullname"], businessUnit: lead["bu.name"],
                        lastActivity: lead.modifiedon, // Folosim data modificării lead-ului ca fallback
                        lastMessage: 'Nicio activitate recentă',
                        unreadCount: unreadCount,
                        lastIncomingMessageTimestamp: null
                    };
                }

                return {
                    id: lead.leadid, name: lead.fullname || "N/A", phone: lead.telephone1, status: lead.new_leadstatus,
                    assignedAgent: lead["_ownerid_value"], ownerName: lead["owner.fullname"], businessUnit: lead["bu.name"],
                    lastActivity: aggregatedData.lastActivity,
                    lastMessage: Utils.truncateText(aggregatedData.lastMessage, 60),
                    unreadCount: unreadCount,
                    lastIncomingMessageTimestamp: aggregatedData.lastIncomingMessageTimestamp
                };
            });

            // Pas 6: Centralizarea și simplificarea logicii de filtrare
            let filteredConversations = finalConversations;

            // Filtrare bazată pe rol și selecție
            if (CURRENT_USER.isSupervisor) {
                // Pentru SUPERVISOR, filtrul de agent din UI este sursa principală de adevăr
                const filter = agentFilter || 'all';
                if (filter === 'mine') {
                    filteredConversations = filteredConversations.filter(c => c.assignedAgent === CURRENT_USER.id);
                } else if (filter === 'unassigned') {
                    filteredConversations = filteredConversations.filter(c => !c.assignedAgent);
                } else if (filter !== 'all') {
                    filteredConversations = filteredConversations.filter(c => c.assignedAgent === filter);
                }
                // Dacă filtrul este 'all', nu se aplică nicio filtrare de agent.
            } else {
                // Pentru AGENT normal, tab-urile de vizualizare sunt sursa de adevăr
                if (viewMode === 'my-conversations') {
                    filteredConversations = filteredConversations.filter(c => c.assignedAgent === CURRENT_USER.id);
                } else if (viewMode === 'available') {
                    filteredConversations = filteredConversations.filter(c => !c.assignedAgent);
                }
                // Vizualizarea 'all' este ascunsă pentru agenții normali
            }

            if (leadCategoryFilter && leadCategoryFilter !== 'all') {
                filteredConversations = filteredConversations.filter(c => Utils.getLeadStatusFromValue(c.status) === leadCategoryFilter);
            }

            // Pas 7: Sortăm și paginăm
            filteredConversations.sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));

            const totalFilteredCount = filteredConversations.length;
            const startIndex = (page - 1) * pageSize;
            const paginatedConversations = filteredConversations.slice(startIndex, startIndex + pageSize);
            const hasMore = (startIndex + paginatedConversations.length) < totalFilteredCount;

            console.log(`--- Finalizare Încărcare: ${paginatedConversations.length} conversații afișate din ${totalFilteredCount} filtrate. Mai sunt? ${hasMore} ---`);

            return { conversations: paginatedConversations, hasMore, page, pageSize, totalLoaded: totalFilteredCount };

        } catch (error) {
            console.error("Eroare critică în APIService.loadConversations:", error);
            return { conversations: [], hasMore: false, page: page, pageSize: pageSize, totalLoaded: 0 };
        }
    }

    // New method to claim unassigned conversation
    static async claimConversation(leadId) {
        if (!CURRENT_USER || !CURRENT_USER.id) {
            throw new Error("Nu există utilizator curent pentru a prelua conversația");
        }

        if (!USER_PERMISSIONS.canClaimUnassigned) {
            throw new Error("Nu aveți permisiunea de a prelua conversații");
        }

        try {
            const data = {
                "ownerid@odata.bind": `/systemusers(${CURRENT_USER.id})`
            };

            await window.parent.Xrm.WebApi.updateRecord("lead", leadId, data);
            console.log(`✅ Conversația ${leadId} a fost preluată de ${CURRENT_USER.name}`);
            
            // Update lead status to 'in-executare' when claimed
            await APIService.updateLeadStatus(leadId, 'in-executare');
            
            return true;
        } catch (error) {
            console.error(`Eroare la preluarea conversației ${leadId}:`, error);
            throw error;
        }
    }

    // Transfer conversation to another agent
    static async transferConversation(leadId, toAgentId) {
        if (!USER_PERMISSIONS.canTransferOwn) {
            throw new Error("Nu aveți permisiunea de a transfera conversații");
        }

        try {
            const data = {
                "ownerid@odata.bind": `/systemusers(${toAgentId})`
            };

            await window.parent.Xrm.WebApi.updateRecord("lead", leadId, data);
            console.log(`✅ Conversația ${leadId} a fost transferată`);
            return true;
        } catch (error) {
            console.error(`Eroare la transferul conversației ${leadId}:`, error);
            throw error;
        }
    }

    // Get agent statistics
    static async getAgentStatistics(agentId = null) {
        const userId = agentId || CURRENT_USER?.id;
        if (!userId) return null;

        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayISO = today.toISOString();

            // Fetch leads assigned to agent
            const leadFetchXml = `
                <fetch version="1.0" aggregate="true">
                    <entity name="lead">
                        <attribute name="leadid" alias="count" aggregate="count" />
                        <attribute name="new_leadstatus" alias="status" groupby="true" />
                        <filter type="and">
                            <condition attribute="ownerid" operator="eq" value="${userId}" />
                        </filter>
                    </entity>
                </fetch>`;

            const result = await window.parent.Xrm.WebApi.retrieveMultipleRecords(
                "lead", 
                "?fetchXml=" + encodeURIComponent(leadFetchXml)
            );

            const stats = {
                total: 0,
                byStatus: {},
                completedToday: 0
            };

            result.entities.forEach(entity => {
                const count = entity.count || 0;
                const status = entity.status || 'unknown';
                const statusKey = Utils.getLeadStatusFromValue(status);
                
                stats.total += count;
                stats.byStatus[statusKey] = count;
                
                if (['contract', 'dezinteresati'].includes(statusKey)) {
                    // Would need additional query to check if completed today
                    // For now, this is a placeholder
                }
            });

            return stats;
        } catch (error) {
            console.error('Eroare la obținerea statisticilor:', error);
            return null;
        }
    }

    static async loadLeadDetails(leadId) {
        if (!window.parent?.Xrm?.WebApi) {
            console.error('Funcția de încărcare detalii lead nu este disponibilă în acest mediu.');
            return null;
        }
        try {
            const result = await window.parent.Xrm.WebApi.retrieveRecord("lead", leadId, 
                "?$select=fullname,firstname,lastname,telephone1,mobilephone,emailaddress1,cr461_id_afacere,ownerid,statuscode,new_rectificarebc,new_nevoipersonale,new_ipotecar,confirminterest,qualificationcomments,new_tipvenit,new_salary,new_yearsofworktotal,address1_city"
            );
            return result;
        } catch (error) {
            console.error(`Eroare la încărcarea detaliilor pentru lead ${leadId}:`, error);
            return null;
        }
    }

    static async assignAgent(leadId, agentId) {
        if (!window.parent?.Xrm?.WebApi) {
            console.error('Funcția de atribuire agent nu este disponibilă.');
            return;
        }
        let data = {};
        if (agentId === 'unassign') {
            data = {};
        } else {
            data = {
                "ownerid@odata.bind": `/systemusers(${agentId})`
            };
        }
        Object.keys(data).forEach(key => {
            if (data[key] === undefined || data[key] === null || data[key] === '') {
                delete data[key];
            }
        });
        try {
            await window.parent.Xrm.WebApi.updateRecord("lead", leadId, data);
            console.log(`✅ Lead ${leadId} atribuit cu succes`);
        } catch (error) {
            console.error(`Eroare la atribuirea agentului pentru lead ${leadId}:`, error);
            throw error;
        }
    }

    static async deleteConversation(leadId) {
        try {
            console.log(`✅ Conversația pentru lead ${leadId} a fost ștearsă (simulat).`);
        } catch (error) {
            console.error(`Eroare la ștergerea conversației pentru lead ${leadId}:`, error);
            throw error;
        }
    }

    static async updateLeadStatus(leadId, statusValue) {
        let numericStatus = statusValue;
        
        if (isNaN(statusValue)) {
            numericStatus = Object.keys(LEAD_STATUS_MAPPING).find(
                key => LEAD_STATUS_MAPPING[key] === statusValue
            );
            
            if (!numericStatus) {
                console.error(`Status invalid: ${statusValue}`);
                throw new Error(`Statusul "${statusValue}" nu există în mapping`);
            }
            
            numericStatus = parseInt(numericStatus);
        }
        
        const data = {
            "new_leadstatus": numericStatus
        };
        
        try {
            await window.parent.Xrm.WebApi.updateRecord("lead", leadId, data);
            console.log(`✅ Statusul pentru lead ${leadId} a fost actualizat la ${numericStatus} (${statusValue})`);
        } catch (error) {
            console.error(`Eroare la actualizarea statusului pentru lead ${leadId}:`, error);
            throw error;
        }
    }

    static async updateLeadField(leadId, fieldName, fieldValue) {
        if (!window.parent?.Xrm?.WebApi) {
            console.error('Funcția de actualizare câmp nu este disponibilă.');
            return;
        }
        
        const data = {};
        data[fieldName] = fieldValue;
        
        try {
            await window.parent.Xrm.WebApi.updateRecord("lead", leadId, data);
            console.log(`✅ Câmpul ${fieldName} actualizat pentru lead ${leadId}`);
            return true;
        } catch (error) {
            console.error(`Eroare la actualizarea câmpului ${fieldName} pentru lead ${leadId}:`, error);
            throw error;
        }
    }

    static async markMessagesAsRead(leadId) {
        try {
            if (!window.parent?.Xrm?.WebApi) {
                throw new Error('Xrm.WebApi nu este disponibil');
            }
            
            console.log(`📖 Se marchează ca citite mesajele pentru lead ${leadId}...`);
            
            const fetchXml = `
                <fetch version="1.0" output-format="xml-platform" mapping="logical" top="50">
                    <entity name="new_new_whatsappconversation">
                        <attribute name="new_new_whatsappconversationid" />
                        <filter type="and">
                            <condition attribute="new_leadid" operator="eq" value="${leadId}" />
                            <condition attribute="new_messageread" operator="eq" value="false" />
                            <condition attribute="new_direction" operator="eq" value="1" />
                        </filter>
                    </entity>
                </fetch>`;
            
            const unreadMessages = await window.parent.Xrm.WebApi.retrieveMultipleRecords(
                "new_new_whatsappconversation", 
                "?fetchXml=" + encodeURIComponent(fetchXml)
            );
            
            console.log(`📊 ${unreadMessages.entities.length} mesaje necitite găsite pentru lead ${leadId}`);
            
            if (unreadMessages.entities.length === 0) {
                console.log(`ℹ️ Nu există mesaje necitite pentru lead ${leadId}`);
                return true;
            }
            
            let updatedCount = 0;
            for (const message of unreadMessages.entities) {
                try {
                    await window.parent.Xrm.WebApi.updateRecord(
                        "new_new_whatsappconversation", 
                        message.new_new_whatsappconversationid, 
                        {
                            "new_messageread": true
                        }
                    );
                    updatedCount++;
                } catch (updateError) {
                    console.error(`Eroare la actualizarea mesajului ${message.new_new_whatsappconversationid}:`, updateError);
                }
            }
            
            console.log(`✅ ${updatedCount} mesaje marcate ca citite pentru lead ${leadId}`);
            return true;
            
        } catch (error) {
            console.error(`Eroare la marcarea mesajelor ca citite pentru lead ${leadId}:`, error);
            throw error;
        }
    }
    
    static async loadMessages(leadId, page = 1, pageSize = 50, append = false) {
        try {
            if (!window.parent?.Xrm?.WebApi) {
                throw new Error('Xrm.WebApi nu este disponibil');
            }
            
            console.log(`📨 Încarcă mesajele pentru lead: ${leadId}, Pagina: ${page}`);
            
            const messageFetchXml = `
                <fetch version="1.0" output-format="xml-platform" mapping="logical" 
                       page="${page}" count="${pageSize}" returntotalrecordcount="true">
                    <entity name="new_new_whatsappconversation">
                        <attribute name="new_new_whatsappconversationid" />
                        <attribute name="new_message" />
                        <attribute name="new_direction" />
                        <attribute name="new_timestamp" />
                        <attribute name="createdon" />
                        <attribute name="new_messageread" />
                        <attribute name="new_archived" />
                        <attribute name="new_sentbyid" />
                        <order attribute="new_timestamp" descending="true" />
                        <filter type="and">
                            <condition attribute="new_leadid" operator="eq" value="${leadId}" />
                            <condition attribute="new_message" operator="not-null" />
                        </filter>
                        <link-entity name="systemuser" from="systemuserid" to="new_sentbyid" alias="sentBy" link-type="outer">
                            <attribute name="fullname" />
                        </link-entity>
                    </entity>
                </fetch>`;

            const result = await window.parent.Xrm.WebApi.retrieveMultipleRecords(
                "new_new_whatsappconversation", 
                "?fetchXml=" + encodeURIComponent(messageFetchXml)
            );
            
            console.log(`📨 ${result.entities.length} mesaje încărcate pentru pagina ${page}`);
            
            const messages = result.entities.map(entity => ({
                id: entity.new_new_whatsappconversationid,
                content: entity.new_message || '',
                timestamp: entity.new_timestamp || entity.createdon,
                type: entity.new_direction === 1 ? 'incoming' : 'outgoing',
                status: entity.new_direction === 1 ? 'received' : 'sent',
                direction: entity.new_direction,
                read: entity.new_messageread === true || entity.new_messageread === 1,
                archived: entity.new_archived === true || entity.new_archived === 1,
                sentBy: entity["sentBy.fullname"] || (entity.new_direction === 1 ? 'Client' : 'Agent')
            }));
            
            // Sortează mesajele cronologic (cele mai vechi primele)
            messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            
            return {
                messages: messages,
                hasMore: result.entities.length === pageSize,
                totalCount: result.entities['@odata.count'] || result.entities.length,
                page: page
            };
            
        } catch (error) {
            console.error('Eroare la încărcarea mesajelor:', error);
            throw error;
        }
    }

    static async checkForNewMessages(lastCheckTimestamp) {
        try {
            if (!window.parent?.Xrm?.WebApi) {
                throw new Error('Xrm.WebApi nu este disponibil');
            }
            
            const fetchXml = `
                <fetch version="1.0" output-format="xml-platform" mapping="logical" top="50">
                    <entity name="new_new_whatsappconversation">
                        <attribute name="new_new_whatsappconversationid" />
                        <attribute name="new_leadid" />
                        <attribute name="new_message" />
                        <attribute name="new_timestamp" />
                        <attribute name="new_direction" />
                        <filter type="and">
                            <condition attribute="new_direction" operator="eq" value="1" />
                            <condition attribute="new_timestamp" operator="gt" value="${lastCheckTimestamp}" />
                        </filter>
                        <link-entity name="lead" from="leadid" to="new_leadid" alias="lead" link-type="inner">
                            <filter type="and">
                                <condition attribute="ownerid" operator="eq" value="${CURRENT_USER.id}" />
                            </filter>
                        </link-entity>
                    </entity>
                </fetch>`;
            
            const result = await window.parent.Xrm.WebApi.retrieveMultipleRecords(
                "new_new_whatsappconversation", 
                "?fetchXml=" + encodeURIComponent(fetchXml)
            );
            
            return result.entities;
        } catch (error) {
            console.error('Eroare la verificarea mesajelor noi:', error);
            throw error;
        }
    }

    static async sendMessage(leadId, message, phoneNumber, sendById) {
        try {
            if (!API_CONFIG.sendMessage) {
                throw new Error("URL-ul pentru trimiterea mesajelor nu este configurat.");
            }
            if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.trim() === '') {
                throw new Error("Numărul de telefon este necesar.");
            }
            if (!message || typeof message !== 'string' || message.trim() === '') {
                throw new Error("Mesajul nu poate fi gol.");
            }

            const cleanedNumber = phoneNumber.replace(/\D/g, '');
            let formattedPhoneNumber;

            if (cleanedNumber === '') {
                throw new Error("Numărul de telefon este gol după curățare.");
            }

            if (cleanedNumber.startsWith('0')) {
                formattedPhoneNumber = '4' + cleanedNumber;
            } else if (cleanedNumber.startsWith('4') && cleanedNumber.length === 11) {
                formattedPhoneNumber = cleanedNumber;
            } else if (cleanedNumber.length === 9 && (cleanedNumber.startsWith('7') || cleanedNumber.startsWith('2') || cleanedNumber.startsWith('3'))) {
                formattedPhoneNumber = '40' + cleanedNumber;
            } else {
                formattedPhoneNumber = cleanedNumber;
            }

            console.log(`📤 Trimite mesaj către lead ${leadId}. Număr: ${formattedPhoneNumber}. Mesaj: ${message.substring(0, 50)}...`);
            
            const payload = {
                action: "sendMessage", 
                leadId: leadId,
                phoneNumber: formattedPhoneNumber,
                message: message,
                sendById: sendById 
            };

            const response = await fetch(API_CONFIG.sendMessage, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error('Eroare răspuns:', errorBody);
                throw new Error(`HTTP ${response.status} la trimiterea mesajului.`);
            }
            
            console.log(`✅ Mesaj trimis către ${formattedPhoneNumber}`);
            return await response.json().catch(() => ({ success: true }));
        } catch (error) {
            console.error('Eroare la trimiterea mesajului:', error);
            throw error;
        }
    }

    static async sendTemplateMessage(leadId, templateName, templateParams, phoneNumber) {
        try {
            if (!API_CONFIG.sendTemplateMessageUrl) {
                throw new Error("URL-ul pentru trimiterea template-urilor nu este configurat.");
            }
            if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.trim() === '') {
                throw new Error("Numărul de telefon este necesar.");
            }

            const cleanedNumber = phoneNumber.replace(/\D/g, '');
            let formattedPhoneNumber;

            if (cleanedNumber === '') {
                throw new Error("Numărul de telefon este gol după curățare.");
            }

            if (cleanedNumber.startsWith('0')) {
                formattedPhoneNumber = '4' + cleanedNumber;
            } else if (cleanedNumber.startsWith('4') && cleanedNumber.length === 11) {
                formattedPhoneNumber = cleanedNumber;
            } else if (cleanedNumber.length === 9 && (cleanedNumber.startsWith('7') || cleanedNumber.startsWith('2') || cleanedNumber.startsWith('3'))) {
                formattedPhoneNumber = '40' + cleanedNumber;
            } else {
                formattedPhoneNumber = cleanedNumber;
            }

            console.log(`📨 Trimitere template '${templateName}' către Lead ${leadId}`);
            console.log(`📱 Număr: ${phoneNumber} → ${formattedPhoneNumber}`);
            console.log(`📝 Parametri:`, templateParams);

            let formattedParams = templateParams;
            if (typeof templateParams === 'object' && !Array.isArray(templateParams)) {
                const keys = Object.keys(templateParams).filter(k => !isNaN(k)).sort();
                if (keys.length > 0) {
                    formattedParams = keys.map(k => templateParams[k]);
                }
            }

            const payload = {
                leadid: leadId,
                templatename: templateName,
                templateparameters: formattedParams,
                phonenumber: formattedPhoneNumber,
                userid: CURRENT_USER ? CURRENT_USER.id : null
            };

            console.log(`🚀 Payload:`, JSON.stringify(payload, null, 2));

            const response = await fetch(API_CONFIG.sendTemplateMessageUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            const responseText = await response.text();
            console.log(`📨 Răspuns (status: ${response.status}):`, responseText);

            if (!response.ok) {
                console.error('❌ Eroare:', response.status, responseText);
                
                let errorMessage = `HTTP ${response.status}`;
                try {
                    const errorData = JSON.parse(responseText);
                    if (errorData.error || errorData.message) {
                        errorMessage = errorData.error || errorData.message;
                    }
                } catch (e) {
                    errorMessage = responseText || `HTTP ${response.status}`;
                }
                
                throw new Error(`Eroare template: ${errorMessage}`);
            }

            let responseData;
            try {
                responseData = JSON.parse(responseText);
            } catch (e) {
                console.warn('⚠️ Răspunsul nu este JSON valid:', responseText);
                responseData = { success: true, response: responseText };
            }

            console.log("✅ Template trimis cu succes:", responseData);
            return { success: true, data: responseData };

        } catch (error) {
            console.error("❌ Eroare în APIService.sendTemplateMessage:", error);
            alert(`Nu s-a putut trimite template-ul: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
}

// UI Manager - UPDATED FOR AGENT VIEW
class UIManager {
    constructor(state) {
        this.state = state;
        this.editingFields = new Set();
        this.isLoadingMessages = false;
        this.isLoadingMoreMessages = false;
        this.initializeElements();
        this.bindEvents();
        this.populateStatusDropdown();
        this.updateViewModeDisplay();
    }

    initializeElements() {
        this.elements = {
            conversationsList: $('#conversationsList'),
            searchInput: $('#searchInput'),
            clearSearch: $('#clearSearch'),
            filterTabs: $('.filter-tab'),
            viewModeSegments: $('.view-mode-segment'), // Am înlocuit viewModeTabs
            chatHeader: $('#chatHeader'),
            chatArea: $('#chatArea'),
            sidebar: $('#sidebar'),
            clientAvatar: $('#clientAvatar'),
            clientName: $('#clientName'),
            clientStatus: $('#clientStatus'),
            statusText: $('#statusText'),
            statusBadge: $('#statusBadge'),
            messagesContainer: $('#messagesContainer'),
            inputArea: $('#inputArea'),
            messageInput: $('#messageInput'),
            sendBtn: $('#sendBtn'),
            templateBtn: $('#templateBtn'),
            quickActions: $('.quick-action'),
            contextMenu: $('#contextMenu'),
            settingsModal: $('#settingsModal'),
            refreshBtn: $('#refreshBtn'),
            statusBtn: $('#statusBtn'),
            statusDropdown: $('#statusDropdown'),
            statusDropdownButton: $('#statusDropdownButton'),
            statusDropdownText: $('.status-dropdown-text'),
            statusFilterDropdown: $('#statusFilterDropdown'),
            agentBtn: $('#agentBtn'),
            agentDropdown: $('#agentDropdown'),
            infoBtn: $('#infoBtn'),
            clientInfoPanel: $('#clientInfoPanel'),
            closeInfoPanel: $('#closeInfoPanel'),
            infoPanelContent: $('#infoPanelContent'),
            // New elements for agent view
            agentDashboardHeader: $('#agentDashboardHeader'),
            agentName: $('#agentName'),
            agentRole: $('#agentRole'),
            statMyActive: $('#statMyActive'),
            statMyUnread: $('#statMyUnread'),
            statAvailable: $('#statAvailable'),
            statCompletedToday: $('#statCompletedToday'),
            agentFilterDropdownContainer: $('#agentFilterDropdownContainer'),
            agentFilterDropdownButton: $('#agentFilterDropdownButton'),
            agentFilterDropdown: $('#agentFilterDropdown'),
            agentFilterDropdownText: $('.agent-filter-dropdown-text'),
            statsToggleBtn: $('#statsToggleBtn'), // Butonul de toggle
            agentStatsContainer: $('#agentStatsContainer'), // Containerul cu statistici
            // Template Modal Elements
            templateModal: $('#templateModal'),
            templateSelector: $('#templateSelector'),
            templateParamsContainer: $('#templateParamsContainer'),
            templatePreview: $('#templatePreview .preview-content'),
            sendTemplateBtn: $('#sendTemplate'),
            cancelTemplateBtn: $('#cancelTemplate'),
            closeTemplateModalBtn: $('#closeTemplateModal')
        };
    }

    updateViewModeDisplay() {
        // ascundem numele agentului
        if (this.elements.agentName) {
            this.elements.agentName.closest('.agent-info').hide();
        }

        // Show/hide view mode tabs based on permissions
        if (CURRENT_USER && CURRENT_USER.isSupervisor) {
            // --- LOGICĂ PENTRU SUPERVISOR ---
            // Modificăm etichetele pentru a reflecta statisticile globale
            $('#statMyActive').next('.stat-label').text('Total Active');
            $('#statMyUnread').next('.stat-label').text('Total Necitite');

            $('.view-mode-segment[data-view="all"]').show();
            $('#agentFilterDropdownContainer').removeClass('d-none');
            
            // Ne asigurăm că lista de agenți este populată
            console.log("--- RULARE MOD ADMIN --- Se populează lista de agenți pentru filtrare.");
            this.populateAgentFilterDropdown();
        } else {
            // --- LOGICĂ PENTRU AGENT NORMAL ---
            // Resetăm etichetele la valorile default
            $('#statMyActive').next('.stat-label').text('Active');
            $('#statMyUnread').next('.stat-label').text('Necitite');

            $('.view-mode-segment[data-view="all"]').hide();
            $('#agentFilterDropdownContainer').addClass('d-none');
        }

        // Update stats
        this.updateDashboardStats();
    }

    updateDashboardStats() {
        // Fallback: actualizează rapid statistici dacă există elemente
        if (this.state.conversationStats) {
            this.elements.statMyActive?.text(this.state.conversationStats.myActive || 0);
            this.elements.statMyUnread?.text(this.state.conversationStats.myUnread || 0);
            this.elements.statAvailable?.text(this.state.conversationStats.available || 0);
            this.elements.statCompletedToday?.text(this.state.conversationStats.completedToday || 0);
        }
    }

    populateStatusDropdown() {
        if (!this.elements || !this.elements.statusFilterDropdown || this.elements.statusFilterDropdown.length === 0) {
            console.warn('Dropdown-ul de statusuri nu există în DOM');
            return;
        }

        this.elements.statusFilterDropdown.empty();

        this.elements.statusFilterDropdown.append(`
            <div class="status-dropdown-item" data-status="all">
                <span class="status-icon all"></span>
                Toate statusurile
            </div>
        `);

        for (const [key, label] of Object.entries(LEAD_STATUS_LABELS)) {
            this.elements.statusFilterDropdown.append(`
                <div class="status-dropdown-item" data-status="${key}">
                    <span class="status-icon status-${key}"></span>
                    ${label}
                </div>
            `);
        }
    }

    populateAgentDropdown() {
        // Fallback: populează dropdown cu agenți dacă există
        if (!this.elements || !this.elements.agentDropdown || this.elements.agentDropdown.length === 0) return;
        this.elements.agentDropdown.empty();
        if (this.state.agents && this.state.agents.length > 0) {
            this.state.agents.forEach(agent => {
                if (agent.id === this.state.currentUser?.id) return;
                this.elements.agentDropdown.append(`
                    <div class="agent-dropdown-item" data-agent="${agent.id}">
                        <span class="agent-badge">${agent.initials || Utils.getInitials(agent.name)}</span>
                        ${agent.name}
                    </div>
                `);
            });
        } else {
            this.elements.agentDropdown.append('<div class="agent-dropdown-item disabled">Niciun agent disponibil</div>');
        }
    }

    populateAgentFilterDropdown() {
        const dropdown = $('#agentFilterDropdown');
        if (!dropdown || dropdown.length === 0) {
            console.warn('Dropdown-ul de filtrare agenți nu există în DOM');
            return;
        }
        dropdown.empty();
        // Opțiuni statice
        dropdown.append(`
            <div class="status-dropdown-item" data-agent="all">
                <i class="fas fa-users"></i>
                Toți agenții
            </div>
            <div class="status-dropdown-item" data-agent="mine">
                <i class="fas fa-user"></i>
                Atribuite mie
            </div>
            <div class="status-dropdown-item" data-agent="unassigned">
                <i class="fas fa-user-slash"></i>
                Neatribuite
            </div>
        `);
        // Separator și lista de agenți
        if (this.state.agents && this.state.agents.length > 0) {
            dropdown.append('<div class="dropdown-separator"></div>');
            this.state.agents.forEach(agent => {
                dropdown.append(`
                    <div class="status-dropdown-item" data-agent="${agent.id}">
                        <span class="agent-badge">${agent.initials || Utils.getInitials(agent.name)}</span>
                        ${agent.name}
                    </div>
                `);
            });
        }
    }

    bindEvents() {
        // Mobile support
        this.enableMobileScroll();
        this.enableMobilePullToRefresh();

        // --- BUTON PLIABIL PENTRU STATISTICI ---
        this.elements.statsToggleBtn.on('click', () => {
            this.elements.agentStatsContainer.toggleClass('expanded');
            this.elements.statsToggleBtn.toggleClass('expanded');
        });

        // Noul event listener pentru comutatorul de vizualizare
        this.elements.viewModeSegments.on('click', (e) => {
            const segment = $(e.currentTarget);
            const viewMode = segment.data('view');

            if (this.state.viewMode === viewMode) return; // Nu facem nimic dacă este deja activ

            this.state.viewMode = viewMode;
            this.elements.viewModeSegments.removeClass('active');
            segment.addClass('active');

            // Resetăm paginarea și încărcăm conversațiile
            this.state.pagination.currentPage = 1;
            this.state.pagination.hasMore = true;
            
            if (window.app && typeof window.app.loadConversations === 'function') {
                window.app.loadConversations(true, true);
            }
        });

        // Search
        let lastSearchValue = '';
        this.elements.searchInput.on('input', Utils.debounce((e) => {
            const value = e.target.value;
            if (value === lastSearchValue) return;
            lastSearchValue = value;
            this.state.filters.search = value;
            this.renderConversations();
            this.toggleClearButton();
        }, 400));

        this.elements.clearSearch.on('click', () => {
            this.elements.searchInput.val('');
            this.state.filters.search = '';
            this.renderConversations();
            this.toggleClearButton();
        });

        // Primary Filters
        this.elements.filterTabs.on('click', (e) => {
            const filter = $(e.currentTarget).data('filter');
            this.state.filters.category = filter;
            this.elements.filterTabs.removeClass('active');
            $(e.currentTarget).addClass('active');
            this.renderConversations();
        });

        // Status Dropdown Button
        this.elements.statusDropdownButton.on('click', (e) => {
            e.stopPropagation();
            this.elements.statusFilterDropdown.toggleClass('show');
        });

        // Status Dropdown Items
        this.elements.statusFilterDropdown.on('click', '.status-dropdown-item', (e) => {
            e.stopPropagation();
            const status = $(e.currentTarget).data('status');
            this.state.filters.leadCategory = status;
            
            const selectedText = $(e.currentTarget).text();
            this.elements.statusDropdownText.text(selectedText);
            this.elements.statusFilterDropdown.removeClass('show');
            
            this.state.pagination.currentPage = 1;
            this.state.pagination.hasMore = true;
            
            if (window.app && typeof window.app.loadConversations === 'function') {
                window.app.loadConversations(true, true);
            }
        });

        // Conversation selection
        this.elements.conversationsList.on('click', '.conversation-item', (e) => {
            const conversationId = $(e.currentTarget).data('conversation-id');
            this.selectConversation(conversationId);
        });

        // Claim conversation button
        this.elements.conversationsList.on('click', '.quick-claim-btn', async (e) => {
            e.stopPropagation();
            const conversationId = $(e.currentTarget).closest('.conversation-item').data('conversation-id');
            await this.claimConversation(conversationId);
        });

        // Category dropdown
        this.elements.statusBtn.on('click', (e) => {
            e.stopPropagation();
            this.elements.statusDropdown.toggle();
        });

        this.elements.statusDropdown.on('click', '.status-dropdown-item', async (e) => {
            e.stopPropagation();
            const status = $(e.currentTarget).data('status');
            await this.changeConversationStatus(status);
            this.elements.statusDropdown.hide();
        });

        // Agent Assignment (Transfer)
        this.elements.agentBtn.on('click', (e) => {
            e.stopPropagation();
            this.elements.agentDropdown.toggle();
        });

        this.elements.agentDropdown.on('click', '.agent-dropdown-item', async (e) => {
            e.stopPropagation();
            const agentId = $(e.currentTarget).data('agent');
            await this.transferConversation(agentId);
            this.elements.agentDropdown.hide();
        });

        $(document).on('click', () => {
            this.elements.statusDropdown.hide();
            this.elements.agentDropdown.hide();
            this.elements.statusFilterDropdown.removeClass('show');
            this.elements.contextMenu.hide();
            this.hideClientInfoPanel();
        });

        this.elements.statusDropdownButton.on('click', e => e.stopPropagation());
        this.elements.clientInfoPanel.on('click', e => e.stopPropagation());

        // Message input
        this.elements.messageInput.on('input', () => {
            this.autoResizeTextarea();
            this.updateSendExperience();
        });

        this.elements.messageInput.on('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!this.elements.sendBtn.is(':disabled')) {
                    this.sendMessage();
                }
            }
        });

        // Send button
        this.elements.sendBtn.on('click', () => {
            this.sendMessage();
        });

        // Template button
        if (this.elements.templateBtn && this.elements.templateBtn.length > 0) {
            this.elements.templateBtn.on('click', () => {
                this.sendTemplateMessage();
            });
        }

        // Template Modal Events
        this.elements.templateSelector.on('change', () => this.updateTemplateDetails());
        this.elements.templateParamsContainer.on('input', 'input', () => this.updateTemplatePreview());
        this.elements.sendTemplateBtn.on('click', () => this.sendTemplateMessage());
        this.elements.cancelTemplateBtn.on('click', () => this.hideTemplateModal());
        this.elements.closeTemplateModalBtn.on('click', () => this.hideTemplateModal());

        // Quick actions
        this.elements.quickActions.on('click', (e) => {
            const $quickAction = $(e.currentTarget);
            if ($quickAction.hasClass('disabled')) return;
            
            const message = $quickAction.data('message');
            this.elements.messageInput.val(message);
            this.autoResizeTextarea();
            this.updateSendExperience();
            this.elements.messageInput.focus();
        });

        // Mobile back button
        $('#mobileBackBtn').on('click', () => {
            $('#chatArea').removeClass('mobile-active');
            $('#sidebar').removeClass('mobile-hidden');
            
            setTimeout(() => {
                this.elements.conversationsList.scrollTop(
                    $(`.conversation-item[data-conversation-id="${this.state.currentConversation?.id}"]`).position()?.top || 0
                );
            }, 300);
        });

        // Context menu
        $(document).on('contextmenu', '.conversation-item', (e) => {
            e.preventDefault();
            const conversationId = $(e.currentTarget).data('conversation-id');
            this.showContextMenu(e.pageX, e.pageY, conversationId);
        });

        // Context menu actions
        this.elements.contextMenu.on('click', '.context-menu-item', async (e) => {
            const action = $(e.currentTarget).data('action');
            await this.handleContextAction(action);
            this.elements.contextMenu.hide();
        });

        // Refresh
        this.elements.refreshBtn.on('click', () => this.refreshData());

        // Settings
        $('#settingsBtn').on('click', () => this.showSettings());
        $('#closeModal, #cancelSettings').on('click', () => this.hideSettings());
        $('#saveSettings').on('click', () => this.saveSettings());

        // Client Info Panel events
        this.elements.infoBtn.on('click', (e) => {
            e.stopPropagation();
            this.showClientInfoPanel();
        });
        this.elements.closeInfoPanel.on('click', () => this.hideClientInfoPanel());

        // Lightbox events
        $('#closeLightbox, #closeLightbox').on('click', () => this.hideImageLightbox());
        $('#imageLightbox').on('click', (e) => {
            if ($(e.target).is('#imageLightbox')) {
                this.hideImageLightbox();
            }
        });

        // Delegate click for images
        this.elements.messagesContainer.on('click', '.attachment-image, .chat-image', (e) => {
            const $img = $(e.currentTarget);
            const src = $img.data('src') || $img.attr('src');
            if (src && !$img.hasClass('image-error')) {
                this.showImageLightbox(src);
            }
        });

        // Error handling for images
        this.elements.messagesContainer.on('error', '.attachment-image, .chat-image', (e) => {
            const $img = $(e.currentTarget);
            $img.addClass('image-error');
            $img.attr('alt', 'Imagine indisponibilă');
            console.warn('Eroare la încărcarea imaginii:', $img.attr('src'));
        });

        // Bind save/cancel events for editable fields
        this.elements.infoPanelContent.on('click', '.edit-btn', async (e) => {
            const $btn = $(e.currentTarget);
            const fieldName = $btn.data('field');
            await this.toggleFieldEdit(fieldName);
        });

        this.elements.infoPanelContent.on('click', '.save-btn', async (e) => {
            const $btn = $(e.currentTarget);
            const fieldName = $btn.data('field');
            await this.saveFieldEdit(fieldName);
        });

        this.elements.infoPanelContent.on('click', '.cancel-btn', (e) => {
            const $btn = $(e.currentTarget);
            const fieldName = $btn.data('field');
            this.cancelFieldEdit(fieldName);
        });

        // Infinite scroll pentru conversații - varianta robustă
        this.elements.conversationsList.on('scroll', Utils.debounce(async () => {
            const list = this.elements.conversationsList[0];
            const isNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 400;

            if (isNearBottom && this.state.pagination.hasMore && !this.state.pagination.isLoading) {
                await this.loadMoreConversations();
            }
        }, 250));

        // Listener pentru noul buton "Încarcă mai multe"
        // Folosim delegare de evenimente pentru a ne asigura că funcționează și pe elemente adăugate dinamic
        this.elements.conversationsList.parent().on('click', '#loadMoreBtn', async () => {
            await this.loadMoreConversations();
        });

        // Infinite scroll pentru mesaje
        this.elements.messagesContainer.on('scroll', Utils.debounce(() => {
            const container = this.elements.messagesContainer[0];
            const scrollTop = container.scrollTop;
            
            // Dacă utilizatorul a derulat aproape de top, încarcă mai multe mesaje
            if (scrollTop < 100 && !this.isLoadingMoreMessages && this.state.currentConversation) {
                const leadId = this.state.currentConversation.id;
                const pagination = this.state.messagePagination[leadId];
                
                if (pagination && pagination.hasMore) {
                    this.loadMoreMessages(leadId);
                }
            }
        }, 200));

        // Click pe butonul de încărcare mesaje vechi
        this.elements.messagesContainer.on('click', '.load-more-messages-trigger button', (e) => {
            e.preventDefault();
            const leadId = $(e.currentTarget).closest('.load-more-messages-trigger').data('lead-id');
            if (leadId && !this.isLoadingMoreMessages) {
                this.loadMoreMessages(leadId);
            }
        });

        // Zoom support for lightbox
        $(document).on('wheel', '#lightboxImage', function(e) {
            e.preventDefault();
            
            const $img = $(this);
            const currentWidth = $img.width();
            const delta = e.originalEvent.deltaY;
            const scaleFactor = delta > 0 ? 0.9 : 1.1;
            const newWidth = currentWidth * scaleFactor;
            
            const originalWidth = this.naturalWidth;
            const minWidth = originalWidth * 0.5;
            const maxWidth = originalWidth * 3;
            
            if (newWidth >= minWidth && newWidth <= maxWidth) {
                $img.css({
                    'max-width': newWidth + 'px',
                    'max-height': 'none',
                    'transition': 'all 0.1s ease'
                });
            }
        });

        // Agent Filter Dropdown Button
        $('#agentFilterDropdownButton').on('click', (e) => {
            e.stopPropagation();
            $('#agentFilterDropdown').toggleClass('show');
        });
        // Agent Filter Dropdown Items
        $('#agentFilterDropdown').on('click', '.status-dropdown-item', (e) => {
            e.stopPropagation();
            const agentFilter = $(e.currentTarget).data('agent');
            this.state.filters.agent = agentFilter || 'all';
            const selectedText = $(e.currentTarget).text().trim();
            $('.agent-filter-dropdown-text').text(selectedText);
            // Clasa active pe elementul selectat
            $('#agentFilterDropdown .status-dropdown-item').removeClass('active');
            $(e.currentTarget).addClass('active');
            $('#agentFilterDropdown').removeClass('show');
            // Reset pagination when filter changes
            this.state.pagination.currentPage = 1;
            this.state.pagination.hasMore = true;
            if (window.app && typeof window.app.loadConversations === 'function') {
                window.app.loadConversations(true, true);
            }
        });
    }

    enableMobileScroll() {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        if (isMobile) {
            // Scroll fix pentru lista de conversații
            this.elements.conversationsList.on('touchstart', function(e) {
                const touch = e.originalEvent.touches[0];
                this.startY = touch.pageY;
                this.startScrollTop = this.scrollTop;
            });
            
            this.elements.conversationsList.on('touchmove', function(e) {
                if (!this.startY) return;
                
                const touch = e.originalEvent.touches[0];
                const deltaY = this.startY - touch.pageY;
                
                if ((this.scrollTop === 0 && deltaY < 0) || 
                    (this.scrollTop + this.clientHeight >= this.scrollHeight && deltaY > 0)) {
                    e.preventDefault();
                }
            });
            
            // Scroll fix pentru mesaje
            this.elements.messagesContainer.on('touchstart', function(e) {
                const touch = e.originalEvent.touches[0];
                this.startY = touch.pageY;
                this.startScrollTop = this.scrollTop;
            });
            
            this.elements.messagesContainer.on('touchmove', function(e) {
                if (!this.startY) return;
                
                const touch = e.originalEvent.touches[0];
                const deltaY = this.startY - touch.pageY;
                
                if ((this.scrollTop === 0 && deltaY < 0) || 
                    (this.scrollTop + this.clientHeight >= this.scrollHeight && deltaY > 0)) {
                    e.preventDefault();
                }
            });
            
            $('body').on('touchmove', function(e) {
                if (!$(e.target).closest('.conversations-list, .messages-container').length) {
                    e.preventDefault();
                }
            });
        }
    }

    enableMobilePullToRefresh() {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        if (isMobile) {
            let startY = 0;
            let currentY = 0;
            let pulling = false;
            
            const pullToRefreshThreshold = 80;
            const $pullIndicator = $('<div class="pull-to-refresh-indicator"><i class="fas fa-arrow-down"></i> Trage pentru a reîmprospăta</div>');
            this.elements.conversationsList.before($pullIndicator);
            
            this.elements.conversationsList.on('touchstart', (e) => {
                if (this.elements.conversationsList[0].scrollTop === 0) {
                    startY = e.touches[0].pageY;
                    pulling = true;
                }
            });
            
            this.elements.conversationsList.on('touchmove', (e) => {
                if (!pulling) return;
                
                currentY = e.touches[0].pageY;
                const distance = currentY - startY;
                
                if (distance > 0 && this.elements.conversationsList[0].scrollTop === 0) {
                    e.preventDefault();
                    
                    const translateY = Math.min(distance * 0.5, pullToRefreshThreshold);
                    $pullIndicator.css('transform', `translateY(${translateY}px)`);
                    
                    if (distance > pullToRefreshThreshold) {
                        $pullIndicator.html('<i class="fas fa-sync fa-spin"></i> Eliberează pentru a reîmprospăta');
                    }
                }
            });
            
            this.elements.conversationsList.on('touchend', async () => {
                if (!pulling) return;
                
                const distance = currentY - startY;
                
                if (distance > pullToRefreshThreshold) {
                    $pullIndicator.html('<i class="fas fa-sync fa-spin"></i> Se reîmprospătează...');
                    
                    if (window.app) {
                        await window.app.loadConversations(true, false);
                    }
                }
                
                $pullIndicator.css('transform', 'translateY(0)');
                setTimeout(() => {
                    $pullIndicator.html('<i class="fas fa-arrow-down"></i> Trage pentru a reîmprospăta');
                }, 300);
                
                pulling = false;
                startY = 0;
                currentY = 0;
            });
        }
    }

    async claimConversation(conversationId) {
        try {
            this.showNotification('Preluare', 'Se preia conversația...');
            
            await APIService.claimConversation(conversationId);
            
            // Reload conversations to reflect change
            if (window.app) {
                await window.app.loadConversations(true, true);
            }
            
            this.showNotification('Succes', 'Conversația a fost preluată cu succes');
        } catch (error) {
            console.error('Eroare la preluarea conversației:', error);
            this.showNotification('Eroare', 'Nu s-a putut prelua conversația');
        }
    }

    async transferConversation(toAgentId) {
        if (!this.state.currentConversation) return;
        
        try {
            const agent = this.state.agents.find(a => a.id === toAgentId);
            const agentName = agent ? agent.name : 'alt agent';
            
            if (confirm(`Sigur doriți să transferați conversația către ${agentName}?`)) {
                await APIService.transferConversation(this.state.currentConversation.id, toAgentId);
                
                // Reload conversations
                if (window.app) {
                    await window.app.loadConversations(true, true);
                }
                
                // Clear current conversation
                this.state.currentConversation = null;
                this.resetChatArea();
                
                this.showNotification('Succes', `Conversația a fost transferată către ${agentName}`);
            }
        } catch (error) {
            console.error('Eroare la transferul conversației:', error);
            this.showNotification('Eroare', 'Nu s-a putut transfera conversația');
        }
    }

    toggleClearButton() {
        if (this.elements.searchInput.val()) {
            this.elements.clearSearch.show();
        } else {
            this.elements.clearSearch.hide();
        }
    }

    autoResizeTextarea() {
        const textarea = this.elements.messageInput[0];
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }

    updateSendExperience() {
        const conversation = this.state.currentConversation;
        if (!conversation) {
            this.elements.messageInput.prop('disabled', true).attr('placeholder', 'Selectează o conversație');
            this.elements.sendBtn.prop('disabled', true);
            this.elements.quickActions.addClass('disabled');
            return;
        }

        const now = new Date().getTime();
        const twentyFourHoursInMs = 24 * 60 * 60 * 1000;
        let isWithin24HourWindow = false;

        // Verificăm ultimul mesaj de la client
        if (conversation.lastIncomingMessageTimestamp) {
            const lastIncomingTime = new Date(conversation.lastIncomingMessageTimestamp).getTime();
            isWithin24HourWindow = (now - lastIncomingTime) < twentyFourHoursInMs;
        }

        const hasText = this.elements.messageInput.val().trim().length > 0;

        if (isWithin24HourWindow) {
            // În fereastra de 24h, se pot trimite mesaje libere
            this.elements.messageInput.prop('disabled', false).attr('placeholder', 'Scrie un mesaj...');
            this.elements.sendBtn.prop('disabled', !hasText);
            this.elements.templateBtn.prop('disabled', false); // Permitem si template-uri
            this.elements.quickActions.removeClass('disabled');
        } else {
            // În afara ferestrei de 24h, doar template-uri
            this.elements.messageInput.prop('disabled', true).attr('placeholder', 'Fereastră 24h închisă. Trimite un template.');
            this.elements.sendBtn.prop('disabled', true); // Butonul de send normal e dezactivat
            this.elements.templateBtn.prop('disabled', false); // Permitem doar template-uri
            this.elements.quickActions.addClass('disabled');
        }
    }

    showContextMenu(x, y, conversationId) {
        this.state.contextMenuConversationId = conversationId;
        this.elements.contextMenu.css({
            left: x + 'px',
            top: y + 'px',
            display: 'block'
        });
    }

    async handleContextAction(action) {
        const conversationId = this.state.contextMenuConversationId;
        if (!conversationId) return;

        switch (action) {
            case 'reply':
                this.selectConversation(conversationId);
                this.elements.messageInput.focus();
                break;
            case 'change-status':
                this.selectConversation(conversationId);
                this.elements.statusBtn.click();
                break;
            case 'transfer':
                this.selectConversation(conversationId);
                this.elements.agentBtn.click();
                break;
            case 'archive':
                console.log('Archive conversation:', conversationId);
                break;
            case 'delete':
                if (confirm('Sigur doriți să ștergeți această conversație?')) {
                    try {
                        await APIService.deleteConversation(conversationId);
                        this.state.conversations = this.state.conversations.filter(c => c.id !== conversationId);
                        this.renderConversations();
                        if (this.state.currentConversation?.id === conversationId) {
                            this.state.currentConversation = null;
                            this.resetChatArea();
                        }
                    } catch (error) {
                        alert('Eroare la ștergerea conversației');
                    }
                }
                break;
        }
    }

    resetChatArea() {
        // TODO: Poate fi extins cu UI mai prietenos
        this.elements.chatHeader.addClass('d-none');
        this.elements.inputArea.addClass('d-none');
        this.elements.messagesContainer.html(`
            <div class="empty-state">
                <i class="fas fa-comments"></i>
                <h3>Business Messaging Dashboard</h3>
                <p>Selectează o conversație pentru a începe să trimiți mesaje</p>
            </div>
        `);
    }

    refreshData() {
        if (window.app && typeof window.app.checkForNewMessages === 'function') {
            window.app.checkForNewMessages();
        }
    }

    showSettings() {
        this.elements.settingsModal.show();
        $('#desktopNotifications').prop('checked', this.state.settings.notifications);
        $('#soundNotifications').prop('checked', this.state.settings.sounds);
        $('#refreshInterval').val(this.state.settings.refreshInterval / 1000);
        $('#messageCheckInterval').val((this.state.settings.messageCheckInterval || 5000) / 1000);
        $('#autoClaimNew').prop('checked', this.state.settings.autoClaimNew);
        $('#maxActiveConversations').val(this.state.settings.maxActiveConversations);
    }

    hideSettings() {
        this.elements.settingsModal.hide();
    }

    saveSettings() {
        this.state.settings.notifications = $('#desktopNotifications').is(':checked');
        this.state.settings.sounds = $('#soundNotifications').is(':checked');
        this.state.settings.refreshInterval = parseInt($('#refreshInterval').val()) * 1000;
        this.state.settings.messageCheckInterval = parseInt($('#messageCheckInterval').val() || 5) * 1000;
        this.state.settings.autoClaimNew = $('#autoClaimNew').is(':checked');
        this.state.settings.maxActiveConversations = parseInt($('#maxActiveConversations').val() || 20);
        
        this.state.saveSettings();
        this.hideSettings();
        
        if (window.app) {
            window.app.startRefreshTimer();
            window.app.startMessagePolling();
        }
    }

    async selectConversation(conversationId) {
        const conversation = this.state.conversations.find(c => c.id === conversationId);
        if (!conversation) return;

        if (this.isLoadingMessages) {
            console.log('⏳ Se încarcă deja mesaje...');
            return;
        }

        const hadUnreadMessages = conversation.unreadCount > 0;

        this.state.currentConversation = conversation;
        
        $('.conversation-item').removeClass('active');
        $(`.conversation-item[data-conversation-id="${conversationId}"]`).addClass('active');

        this.elements.chatHeader.removeClass('d-none');
        this.elements.inputArea.removeClass('d-none');

        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            $('#sidebar').addClass('mobile-hidden');
            $('#chatArea').addClass('mobile-active');
            
            setTimeout(() => {
                this.elements.messageInput.focus();
            }, 300);
        }

        this.updateChatHeader(conversation);
        this.populateClientInfoPanel(conversation);

        await this.loadMessages(conversationId);

        if (hadUnreadMessages) {
            try {
                await APIService.markMessagesAsRead(conversation.id);
                conversation.unreadCount = 0;
                this.renderConversations();
                console.log(`📖 Mesaje marcate ca citite pentru ${conversationId}`);
            } catch (error) {
                console.error(`Eroare la marcarea mesajelor ca citite:`, error);
            }
        }
        this.updateSendExperience();
    }

    updateChatHeader(conversation) {
        this.elements.clientAvatar.text(Utils.getInitials(conversation.name));
        const statusKey = Utils.getLeadStatusFromValue(conversation.status);
        this.elements.clientAvatar.removeClass().addClass(`client-avatar status-${statusKey}`);

        this.elements.clientName.text(conversation.name);
        
        const businessUnitOwnerInfo = $('#businessUnitOwnerInfo');
        const businessUnitText = $('#businessUnitText');
        const ownerText = $('#ownerText');
        
        businessUnitText.text('');
        ownerText.text('');
        
        if (conversation.businessUnit || conversation.ownerName) {
            businessUnitOwnerInfo.show();
            
            if (conversation.businessUnit) {
                businessUnitText.text(conversation.businessUnit);
            }
            
            if (conversation.ownerName) {
                ownerText.text(conversation.businessUnit ? ` / ${conversation.ownerName}` : conversation.ownerName);
            }
        } else {
            businessUnitOwnerInfo.hide();
        }
        
        this.elements.statusText.text(conversation.status);

        if (statusKey) {
            const statusLabel = Utils.getLeadStatusLabel(statusKey);
            this.elements.statusBadge.text(statusLabel);
            this.elements.statusBadge.removeClass().addClass(`status-badge-header status-${statusKey}`);
            this.elements.statusBadge.show();
        } else {
            this.elements.statusBadge.hide();
        }
    }

    showClientInfoPanel() {
        if (this.state.currentConversation && this.elements.clientInfoPanel) {
            this.populateClientInfoPanel(this.state.currentConversation);
            this.elements.clientInfoPanel.addClass('show');
        }
    }

    hideClientInfoPanel() {
        if (this.elements.clientInfoPanel) {
            this.elements.clientInfoPanel.removeClass('show');
        }
    }

    populateClientInfoPanel(conversation) {
        if (!conversation) {
            this.elements.infoPanelContent.html('<div class="empty-state"><p>Selectează o conversație.</p></div>');
            return;
        }

        const statusKey = Utils.getLeadStatusFromValue(conversation.status);
        const statusLabel = Utils.getLeadStatusLabel(statusKey);

        let agentName = 'Neatribuit';
        if (conversation.assignedAgent) {
            const agent = this.state.agents.find(a => a.id === conversation.assignedAgent);
            agentName = agent ? agent.name : (conversation.assignedAgentName || 'Agent necunoscut');
        }

        const html = `
            <div class="info-section">
                <div class="section-header">
                    <i class="fas fa-address-card section-icon" style="color: #2563EB;"></i>
                    <h4>Date de Contact</h4>
                </div>
                <div class="info-item">
                    <div class="info-item-content">
                        <i class="fas fa-user item-icon" style="color: #3B82F6;"></i>
                        <div class="info-details">
                            <label class="info-label">Nume Client</label>
                            <div class="info-value">${conversation.name || 'Nume indisponibil'}</div>
                        </div>
                    </div>
                </div>
                <div class="info-item">
                    <div class="info-item-content">
                        <i class="fas fa-phone item-icon" style="color: #10B981;"></i>
                        <div class="info-details">
                            <label class="info-label">Telefon</label>
                            <div class="info-value">${conversation.phone || 'Telefon indisponibil'}</div>
                        </div>
                    </div>
                </div>
                <div class="info-item">
                    <div class="info-item-content">
                        <i class="fas fa-envelope item-icon" style="color: #F59E0B;"></i>
                        <div class="info-details">
                            <label class="info-label">Email</label>
                            <div class="info-value">${conversation.email || 'Email indisponibil'}</div>
                        </div>
                    </div>
                </div>
                <div class="info-item">
                    <div class="info-item-content">
                        <i class="fas fa-map-marker-alt item-icon" style="color: #EF4444;"></i>
                        <div class="info-details">
                            <label class="info-label">Oraș</label>
                            <div class="info-value">${conversation.city || 'Oraș nespecificat'}</div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="info-section">
                <div class="section-header">
                    <i class="fas fa-tasks section-icon" style="color: #8B5CF6;"></i>
                    <h4>Status și Atribuire</h4>
                </div>
                <div class="info-item">
                    <div class="info-item-content">
                        <i class="fas fa-flag item-icon" style="color: #8B5CF6;"></i>
                        <div class="info-details">
                            <label class="info-label">Status Lead</label>
                            <div class="info-value">
                                <span class="status-badge-info status-${statusKey}">${statusLabel}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="info-item">
                    <div class="info-item-content">
                        <i class="fas fa-user-shield item-icon" style="color: #059669;"></i>
                        <div class="info-details">
                            <label class="info-label">Agent Responsabil</label>
                            <div class="info-value">${agentName}</div>
                        </div>
                    </div>
                </div>
                <div class="info-item">
                    <div class="info-item-content">
                        <i class="fas fa-building item-icon" style="color: #6366F1;"></i>
                        <div class="info-details">
                            <label class="info-label">Unitate Business</label>
                            <div class="info-value">${conversation.businessUnit || 'Indisponibil'}</div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="info-section">
                <div class="section-header">
                    <i class="fas fa-briefcase section-icon" style="color: #047857;"></i>
                    <h4>Informații Profesionale</h4>
                </div>
                <div class="info-item">
                    <div class="info-item-content">
                        <i class="fas fa-calendar-alt item-icon" style="color: #0891B2;"></i>
                        <div class="info-details">
                            <label class="info-label">Vechime Totală în Muncă</label>
                            <div class="info-value-editable">
                                <input type="number" data-field="new_yearsofworktotal" value="${conversation.yearsOfWork || ''}" placeholder="Ani" disabled>
                                <button class="edit-btn" data-field="new_yearsofworktotal" title="Editează">
                                    <i class="fas fa-pencil-alt"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="info-item">
                    <div class="info-item-content">
                        <i class="fas fa-file-invoice-dollar item-icon" style="color: #7C3AED;"></i>
                        <div class="info-details">
                            <label class="info-label">Tip Venit</label>
                            <div class="info-value-editable">
                                <input type="text" data-field="new_tipvenit" value="${conversation.tipVenit || ''}" placeholder="Ex: Salariu, PFA" disabled>
                                <button class="edit-btn" data-field="new_tipvenit" title="Editează">
                                    <i class="fas fa-pencil-alt"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="info-item">
                    <div class="info-item-content">
                        <i class="fas fa-money-bill-wave item-icon" style="color: #10B981;"></i>
                        <div class="info-details">
                            <label class="info-label">Venit Net Lunar</label>
                            <div class="info-value-editable">
                                <input type="number" data-field="new_salary" value="${conversation.salary || ''}" placeholder="RON" disabled>
                                <button class="edit-btn" data-field="new_salary" title="Editează">
                                    <i class="fas fa-pencil-alt"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="info-section">
                <div class="section-header">
                    <i class="fas fa-hand-holding-usd section-icon" style="color: #DC2626;"></i>
                    <h4>Nevoi Financiare</h4>
                </div>
                <div class="info-item">
                    <div class="info-item-content">
                        <i class="fas fa-check-circle item-icon" style="color: #059669;"></i>
                        <div class="info-details">
                            <label class="info-label">Confirmare Interes Credit</label>
                            <div class="info-value-editable">
                                <select data-field="confirminterest" disabled>
                                    <option value="">Selectează</option>
                                    <option value="true" ${conversation.confirmInterest === true ? 'selected' : ''}>Da</option>
                                    <option value="false" ${conversation.confirmInterest === false ? 'selected' : ''}>Nu</option>
                                </select>
                                <button class="edit-btn" data-field="confirminterest" title="Editează">
                                    <i class="fas fa-pencil-alt"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="info-item">
                    <div class="info-item-content">
                        <i class="fas fa-exclamation-triangle item-icon" style="color: #F59E0B;"></i>
                        <div class="info-details">
                            <label class="info-label">Rectificare Birou Credit</label>
                            <div class="info-value-editable">
                                <select data-field="new_rectificarebc" disabled>
                                    <option value="">Selectează</option>
                                    <option value="true" ${conversation.rectificareBC === true ? 'selected' : ''}>Da</option>
                                    <option value="false" ${conversation.rectificareBC === false ? 'selected' : ''}>Nu</option>
                                </select>
                                <button class="edit-btn" data-field="new_rectificarebc" title="Editează">
                                    <i class="fas fa-pencil-alt"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="info-item">
                    <div class="info-item-content">
                        <i class="fas fa-heart item-icon" style="color: #EC4899;"></i>
                        <div class="info-details">
                            <label class="info-label">Nevoi Personale</label>
                            <div class="info-value-editable">
                                <input type="text" data-field="new_nevoipersonale" value="${conversation.nevoiPersonale || ''}" placeholder="Ex: Consolidare datorii" disabled>
                                <button class="edit-btn" data-field="new_nevoipersonale" title="Editează">
                                    <i class="fas fa-pencil-alt"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="info-item">
                    <div class="info-item-content">
                        <i class="fas fa-home item-icon" style="color: #3B82F6;"></i>
                        <div class="info-details">
                            <label class="info-label">Credit Ipotecar</label>
                            <div class="info-value-editable">
                                <select data-field="new_ipotecar" disabled>
                                    <option value="">Selectează</option>
                                    <option value="true" ${conversation.ipotecar === true ? 'selected' : ''}>Da</option>
                                    <option value="false" ${conversation.ipotecar === false ? 'selected' : ''}>Nu</option>
                                </select>
                                <button class="edit-btn" data-field="new_ipotecar" title="Editează">
                                    <i class="fas fa-pencil-alt"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="info-section">
                <div class="section-header">
                    <i class="fas fa-clipboard-list section-icon" style="color: #6366F1;"></i>
                    <h4>Observații și Note</h4>
                </div>
                <div class="info-item">
                    <div class="info-item-content full-width">
                        <div class="info-details">
                            <label class="info-label">Comentarii de Calificare</label>
                            <div class="info-value-editable">
                                <textarea data-field="qualificationcomments" rows="3" placeholder="Adaugă observații..." disabled>${conversation.qualificationComments || ''}</textarea>
                                <button class="edit-btn" data-field="qualificationcomments" title="Editează">
                                    <i class="fas fa-pencil-alt"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.elements.infoPanelContent.html(html);
    }

    async toggleFieldEdit(fieldName) {
        const $container = $(`.info-value-editable:has([data-field="${fieldName}"])`);
        const $input = $container.find('input, select, textarea');
        const $editBtn = $container.find('.edit-btn');
        
        if ($input.is(':disabled')) {
            // Enable editing
            $input.prop('disabled', false);
            $editBtn.html('<i class="fas fa-check"></i>').addClass('save-btn').removeClass('edit-btn');
            $input.focus();
            
            // Add cancel button
            const $cancelBtn = $('<button class="cancel-btn" title="Anulează"><i class="fas fa-times"></i></button>');
            $cancelBtn.attr('data-field', fieldName);
            $container.append($cancelBtn);
            
            this.editingFields.add(fieldName);
        } else {
            // Save
            await this.saveFieldEdit(fieldName);
        }
    }

    async saveFieldEdit(fieldName) {
        if (!this.state.currentConversation) return;

        const $container = $(`.info-value-editable:has([data-field="${fieldName}"])`);
        const $input = $container.find('input, select, textarea');
        let value = $input.val();

        // Convert string values to appropriate types
        if ($input.is('select') && (value === 'true' || value === 'false')) {
            value = value === 'true';
        } else if ($input.attr('type') === 'number' && value) {
            value = parseFloat(value);
        }

        try {
            await APIService.updateLeadField(this.state.currentConversation.id, fieldName, value);
            
            // Update local state
            const fieldMapping = {
                'new_rectificarebc': 'rectificareBC',
                'new_nevoipersonale': 'nevoiPersonale',
                'new_ipotecar': 'ipotecar',
                'confirminterest': 'confirmInterest',
                'qualificationcomments': 'qualificationComments',
                'new_tipvenit': 'tipVenit',
                'new_salary': 'salary',
                'new_yearsofworktotal': 'yearsOfWork'
            };
            
            const localFieldName = fieldMapping[fieldName] || fieldName;
            this.state.currentConversation[localFieldName] = value;
            
            // Update conversation in list
            const convIndex = this.state.conversations.findIndex(
                c => c.id === this.state.currentConversation.id
            );
            if (convIndex !== -1) {
                this.state.conversations[convIndex][localFieldName] = value;
            }
            
            this.showNotification('Succes', 'Câmpul a fost actualizat');
            
            // Reset field to disabled state
            $input.prop('disabled', true);
            const $saveBtn = $container.find('.save-btn');
            $saveBtn.html('<i class="fas fa-pencil-alt"></i>').addClass('edit-btn').removeClass('save-btn');
            $container.find('.cancel-btn').remove();
            
            this.editingFields.delete(fieldName);
        } catch (error) {
            this.showNotification('Eroare', `Nu s-a putut actualiza câmpul: ${error.message}`);
        }
    }

    cancelFieldEdit(fieldName) {
        this.editingFields.delete(fieldName);
        this.populateClientInfoPanel(this.state.currentConversation);
    }

    async changeConversationStatus(status) {
        if (!this.state.currentConversation) return;

        try {
            await APIService.updateLeadStatus(this.state.currentConversation.id, status);
            
            const numericStatus = Object.keys(LEAD_STATUS_MAPPING).find(
                key => LEAD_STATUS_MAPPING[key] === status
            ) || '100000002';
            
            this.state.currentConversation.status = numericStatus;
            const convIndex = this.state.conversations.findIndex(
                c => c.id === this.state.currentConversation.id
            );
            if (convIndex !== -1) {
                this.state.conversations[convIndex].status = numericStatus;
            }

            this.updateChatHeader(this.state.currentConversation);
            this.renderConversations();
            this.populateClientInfoPanel(this.state.currentConversation);

            console.log(`✅ Status actualizat la: ${Utils.getLeadStatusLabel(status)}`);

        } catch (error) {
            console.error('Eroare la schimbarea statusului:', error);
            alert('Eroare la actualizarea statusului.');
        }
    }

    // Metodă nouă pentru încărcarea mai multor mesaje
    async loadMoreMessages(leadId) {
        if (this.isLoadingMoreMessages) return;
        try {
            this.isLoadingMoreMessages = true;
            const pagination = this.state.messagePagination[leadId] || { page: 1, hasMore: true };
            const nextPage = pagination.page + 1;
            // Salvează poziția de scroll înainte de încărcare
            const container = this.elements.messagesContainer[0];
            const oldScrollHeight = container.scrollHeight;
            const oldScrollTop = container.scrollTop;
            // Afișează indicator de încărcare la început
            this.showMessagesLoadingIndicator('top');
            const result = await APIService.loadMessages(leadId, nextPage, 30, true);
            if (result.messages.length > 0) {
                const currentMessages = this.state.messages[leadId] || [];
                // Adaugă doar mesajele care nu există deja (după id)
                const newMessages = result.messages.filter(
                    msg => !currentMessages.some(m => m.id === msg.id)
                );
                this.state.messages[leadId] = [...newMessages, ...currentMessages];
                this.state.messagePagination[leadId] = {
                    page: nextPage,
                    hasMore: result.hasMore
                };
                this.renderMessages(this.state.messages[leadId]);
                // Ajustează scroll-ul pentru a păstra poziția vizuală
                setTimeout(() => {
                    const newScrollHeight = container.scrollHeight;
                    container.scrollTop = newScrollHeight - oldScrollHeight + oldScrollTop;
                }, 30);
            }
            this.hideMessagesLoadingIndicator();
        } catch (error) {
            this.hideMessagesLoadingIndicator();
            this.showNotification('Eroare', 'Nu s-au putut încărca mesajele anterioare', 'error');
        } finally {
            this.isLoadingMoreMessages = false;
        }
    }

    // Adaugă metode pentru indicatorul de încărcare
    showMessagesLoadingIndicator(position = 'top') {
        const loadingHtml = `
            <div class="messages-loading-indicator ${position}">
                <div class="spinner-border spinner-border-sm text-primary" role="status">
                    <span class="visually-hidden">Se încarcă...</span>
                </div>
                <span class="ms-2">Se încarcă mesaje anterioare...</span>
            </div>
        `;
        if (position === 'top') {
            this.elements.messagesContainer.prepend(loadingHtml);
        } else {
            this.elements.messagesContainer.append(loadingHtml);
        }
    }

    hideMessagesLoadingIndicator() {
        this.elements.messagesContainer.find('.messages-loading-indicator').remove();
    }

    // Metodă helper pentru gruparea mesajelor pe zile
    groupMessagesByDay(messages) {
        const groups = {};
        
        messages.forEach(msg => {
            const date = new Date(msg.timestamp);
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            
            let dayKey;
            if (date.toDateString() === today.toDateString()) {
                dayKey = 'Astăzi';
            } else if (date.toDateString() === yesterday.toDateString()) {
                dayKey = 'Ieri';
            } else {
                dayKey = date.toLocaleDateString('ro-RO', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            }
            
            if (!groups[dayKey]) {
                groups[dayKey] = [];
            }
            groups[dayKey].push(msg);
        });
        
        // Sortează cheile pentru a avea ordinea corectă (cele mai recente primele)
        const sortedKeys = Object.keys(groups).sort((a, b) => {
            if (a === 'Astăzi') return -1;
            if (b === 'Astăzi') return 1;
            if (a === 'Ieri') return -1;
            if (b === 'Ieri') return 1;
            return 0;
        });
        
        const sortedGroups = {};
        sortedKeys.forEach(key => {
            sortedGroups[key] = groups[key];
        });
        
        return sortedGroups;
    }

    // Modifică renderMessages pentru a gestiona infinite scroll
    renderMessages(messages) {
        if (!messages || messages.length === 0) {
            this.elements.messagesContainer.html(`
                <div class="empty-state">
                    <i class="fas fa-comments"></i>
                    <h3>Niciun mesaj</h3>
                    <p>Trimite un mesaj pentru a începe conversația.</p>
                </div>
            `);
            return;
        }
        
        // Grupează mesajele pe zile pentru o vizualizare mai bună
        const messagesByDay = this.groupMessagesByDay(messages);
        let messagesHtml = '';
        
        // Adaugă indicator dacă mai sunt mesaje de încărcat
        const leadId = this.state.currentConversation?.id;
        const pagination = this.state.messagePagination[leadId];
        
        if (pagination && pagination.hasMore) {
            messagesHtml += `
                <div class="load-more-messages-trigger" data-lead-id="${leadId}">
                    <button class="btn btn-sm btn-outline-primary">
                        <i class="fas fa-history me-2"></i>Încarcă mesaje mai vechi
                    </button>
                </div>
            `;
        }
        
        // Renderează mesajele grupate pe zile
        for (const [day, dayMessages] of Object.entries(messagesByDay)) {
            messagesHtml += `
                <div class="message-day-separator">
                    <span>${day}</span>
                </div>
            `;
            
            dayMessages.forEach(msg => {
                messagesHtml += this.getMessageHTML(msg);
            });
        }
        
        this.elements.messagesContainer.html(messagesHtml);
        // Scroll la ultimul mesaj după render
        const container = this.elements.messagesContainer[0];
        if (container) {
            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
        }

        // --- GESTIONAREA BUTONULUI "ÎNCARCĂ MAI MULTE" ---
        // Eliminăm butonul vechi, dacă există
        this.elements.conversationsList.parent().find('.load-more-container').remove();

        if (this.state.pagination.hasMore) {
            // Dacă mai sunt pagini de încărcat, adăugăm butonul
            const buttonHtml = `
                <div class="load-more-container">
                    <button id="loadMoreBtn" class="load-more-btn">Încarcă mai multe</button>
                </div>
            `;
            this.elements.conversationsList.after(buttonHtml); // Adăugăm butonul DUPĂ listă
        }
    }

    getMessageHTML(message) {
        const time = Utils.formatTime(message.timestamp);
        const messageClass = `message ${message.type}`;
        
        let contentHtml;
        
        const urlRegex = /^(https?:\/\/[^\s]+)$/;
        const trimmedContent = message.content.trim();
        const isOnlyUrl = urlRegex.test(trimmedContent);
        
        if (isOnlyUrl) {
            if (Utils.isImageUrl(trimmedContent)) {
                contentHtml = `
                    <div class="attachment">
                        <img src="${trimmedContent}" alt="Imagine primită" class="chat-image attachment-image" 
                             data-src="${trimmedContent}" loading="lazy"
                             style="cursor: pointer;"
                             onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2Y0ZjRmNCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmaWxsPSIjOTk5IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQiPkltYWdpbmUgaW5kaXNwb25pYmlsxIM8L3RleHQ+PC9zdmc+'; this.style.cursor='default';">
                    </div>`;
            } else if (Utils.isPdfUrl(trimmedContent)) {
                const fileName = decodeURIComponent(trimmedContent.split('/').pop().split('?')[0]);
                contentHtml = `
                    <div class="attachment">
                        <a href="${trimmedContent}" target="_blank" rel="noopener noreferrer" class="attachment-pdf" 
                           title="Deschide PDF: ${fileName}">
                            <i class="fas fa-file-pdf"></i>
                            <span>${Utils.truncateText(fileName, 30)}</span>
                            <i class="fas fa-external-link-alt ms-2"></i>
                        </a>
                    </div>`;
            } else {
                contentHtml = `<a href="${trimmedContent}" target="_blank" rel="noopener noreferrer">${trimmedContent}</a>`;
            }
        } else {
            contentHtml = Utils.linkify(message.content);
        }

        let senderInfo = '';
        if (message.type === 'outgoing' && message.sentBy && message.sentBy.toLowerCase() !== 'client') {
            senderInfo = `<div class="message-sender">trimis de ${$('<div>').text(message.sentBy).html()}</div>`;
        }

        let statusIcon = '';
        if (message.type === 'outgoing') {
            const iconClass = message.status === 'sent' ? 'fa-check-double' : 
                             message.status === 'sending' ? 'fa-clock' : 
                             message.status === 'failed' ? 'fa-exclamation-circle' : 'fa-check';
            statusIcon = `<i class="message-status-icon fas ${iconClass} status-${message.status || 'sent'}"></i>`;
        }

        return `
            <div class="${messageClass}" data-message-id="${message.id}">
                <div class="message-bubble">
                    <div class="message-content">
                        ${contentHtml}
                    </div>
                    <div class="message-footer">
                        <span class="message-time">${time}</span>
                        ${statusIcon}
                    </div>
                    ${senderInfo}
                </div>
            </div>
        `;
    }

    showImageLightbox(src) {
        const $lightbox = $('#imageLightbox');
        const $img = $('#lightboxImage');
        const $loading = $('.lightbox-loading');
        
        if ($lightbox.length === 0) {
            $('body').append(`
                <div id="imageLightbox" style="display: none;">
                    <div class="lightbox-content">
                        <button id="closeLightbox" class="lightbox-close">&times;</button>
                        <div class="lightbox-loading">
                            <div class="spinner-border text-light" role="status">
                                <span class="visually-hidden">Se încarcă...</span>
                            </div>
                        </div>
                        <img id="lightboxImage" class="lightbox-image" style="display: none;">
                    </div>
                </div>
            `);
            
            $('#closeLightbox').on('click', () => this.hideImageLightbox());
            $('#imageLightbox').on('click', (e) => {
                if ($(e.target).is('#imageLightbox')) {
                    this.hideImageLightbox();
                }
            });
        }
        
        $('#lightboxImage').hide().attr('src', '');
        $('.lightbox-loading').show();
        $('#imageLightbox').css('display', 'flex').hide().fadeIn(200);
        
        $('body').css('overflow', 'hidden');
        
        const img = new Image();
        
        img.onload = () => {
            const maxWidth = window.innerWidth * 0.9;
            const maxHeight = window.innerHeight * 0.9;
            const aspectRatio = img.width / img.height;
            
            let displayWidth = img.width;
            let displayHeight = img.height;
            
            if (displayWidth > maxWidth) {
                displayWidth = maxWidth;
                displayHeight = displayWidth / aspectRatio;
            }
            
            if (displayHeight > maxHeight) {
                displayHeight = maxHeight;
                displayWidth = displayHeight * aspectRatio;
            }
            
            $('.lightbox-loading').fadeOut(200, () => {
                $('#lightboxImage').css({
                    'max-width': displayWidth + 'px',
                    'max-height': displayHeight + 'px'
                }).attr('src', src).fadeIn(200);
            });
        };
        
        img.onerror = () => {
            $('.lightbox-loading').html(`
                <div class="text-light text-center">
                    <i class="fas fa-exclamation-triangle fa-3x mb-3"></i>
                    <p>Imaginea nu a putut fi încărcată</p>
                    <button class="btn btn-secondary mt-2" onclick="$('#imageLightbox').fadeOut(200);">
                        Închide
                    </button>
                </div>
            `);
        };
        
        img.src = src;
        
        $(document).on('keydown.lightbox', (e) => {
            if (e.key === 'Escape') {
                this.hideImageLightbox();
            }
        });
    }

    renderConversations() {
        const list = this.elements.conversationsList;
        if (!list || list.length === 0) return;
        const search = (this.state.filters.search || '').toLowerCase();
        const leadCategory = this.state.filters.leadCategory;
        let conversations = this.state.conversations || [];
        // Filtrare după status
        if (leadCategory && leadCategory !== 'all') {
            conversations = conversations.filter(c => Utils.getLeadStatusFromValue(c.status) === leadCategory);
        }
        // Filtrare după căutare
        if (search) {
            conversations = conversations.filter(c =>
                (c.name && c.name.toLowerCase().includes(search)) ||
                (c.phone && c.phone.toLowerCase().includes(search)) ||
                (c.email && c.email.toLowerCase().includes(search))
            );
        }
        if (conversations.length === 0) {
            list.html('<div class="empty-state"><i class="fas fa-comments"></i><h3>Nicio conversație</h3><p>Nu există conversații pentru filtrul selectat.</p></div>');
            return;
        }
        let html = '';
        conversations.forEach(conv => {
            const statusKey = Utils.getLeadStatusFromValue(conv.status);
            const statusLabel = Utils.getLeadStatusLabel(statusKey);
            const isActive = this.state.currentConversation && this.state.currentConversation.id === conv.id;

            // Pregătim informațiile despre agent și agenție
            let assignmentText = '';
            if (conv.ownerName) {
                assignmentText = conv.ownerName;
                if (conv.businessUnit) {
                    assignmentText += ` (${conv.businessUnit})`;
                }
            } else if (conv.businessUnit) {
                assignmentText = conv.businessUnit;
            }

            html += `
                <div class="conversation-item${isActive ? ' active' : ''}" data-conversation-id="${conv.id}">
                    <div class="conversation-avatar status-${statusKey}">${Utils.getInitials(conv.name)}</div>
                    <div class="conversation-details">
                        <div class="conversation-title">${conv.name || 'Nume necunoscut'}</div>
                        <div class="conversation-meta">
                            <span class="conversation-status status-badge status-${statusKey}">${statusLabel}</span>
                            ${assignmentText ? `<span class="assignment-info">${assignmentText}</span>` : ''}
                        </div>
                        <div class="conversation-last-message">${conv.lastMessage || ''}</div>
                    </div>
                    ${conv.unreadCount > 0 ? `<span class="conversation-unread">${conv.unreadCount}</span>` : ''}
                    ${!conv.assignedAgent ? `<button class="quick-claim-btn" title="Preia conversația"><i class="fas fa-user-plus"></i></button>` : ''}
                </div>
            `;
        });
        list.html(html);

        // --- GESTIONAREA BUTONULUI "ÎNCARCĂ MAI MULTE" ---
        // Eliminăm butonul vechi, dacă există
        list.parent().find('.load-more-container').remove();

        if (this.state.pagination.hasMore) {
            // Dacă mai sunt pagini de încărcat, adăugăm butonul
            const buttonHtml = `
                <div class="load-more-container">
                    <button id="loadMoreBtn" class="load-more-btn">Încarcă mai multe</button>
                </div>
            `;
            list.after(buttonHtml); // Adăugăm butonul DUPĂ listă
        }
    }

    showNotification(title, message, type = 'info') {
        let $notif = $('#ui-notification');
        if ($notif.length === 0) {
            $notif = $('<div id="ui-notification" class="ui-notification"></div>').appendTo('body');
        }
        $notif.removeClass().addClass('ui-notification').addClass(type);
        $notif.html(`<strong>${title}</strong><br>${message}`);
        $notif.fadeIn(200);
        clearTimeout(window._notifTimeout);
        window._notifTimeout = setTimeout(() => {
            $notif.fadeOut(400);
        }, 3500);
    }

    async loadMessages(conversationId) {
        if (!conversationId) return;
        this.isLoadingMessages = true;
        try {
            const result = await APIService.loadMessages(conversationId, 1, 30);
            this.state.messages[conversationId] = result.messages;
            this.state.messagePagination[conversationId] = {
                page: 1,
                hasMore: result.hasMore
            };
            this.renderMessages(result.messages);
        } catch (e) {
            this.showNotification('Eroare', 'Nu s-au putut încărca mesajele', 'error');
            this.elements.messagesContainer.html('<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Eroare la încărcarea mesajelor</h3></div>');
        } finally {
            this.isLoadingMessages = false;
        }
    }

    async sendMessage() {
        const conversation = this.state.currentConversation;
        if (!conversation) return;
        const input = this.elements.messageInput;
        const message = input.val().trim();
        if (!message) return;
        input.prop('disabled', true);
        this.elements.sendBtn.prop('disabled', true);
        // Adaugă mesaj local cu status sending
        const tempId = 'temp-' + Date.now();
        const msgObj = {
            id: tempId,
            content: message,
            timestamp: new Date().toISOString(),
            type: 'outgoing',
            status: 'sending',
            sentBy: this.state.currentUser?.name || 'Agent'
        };
        this.state.messages[conversation.id] = this.state.messages[conversation.id] || [];
        this.state.messages[conversation.id].push(msgObj);
        this.renderMessages(this.state.messages[conversation.id]);
        input.val('');
        this.autoResizeTextarea();
        try {
            await APIService.sendMessage(conversation.id, message, conversation.phone, this.state.currentUser?.id);
            // Marchează ca trimis
            msgObj.status = 'sent';
            this.renderMessages(this.state.messages[conversation.id]);
            this.showNotification('Succes', 'Mesaj trimis', 'success');
            // Reîncarcă mesajele pentru a sincroniza cu serverul
            setTimeout(() => this.loadMessages(conversation.id), 500);
        } catch (e) {
            msgObj.status = 'failed';
            this.renderMessages(this.state.messages[conversation.id]);
            this.showNotification('Eroare', 'Mesajul nu a putut fi trimis', 'error');
        } finally {
            input.prop('disabled', false);
            this.elements.sendBtn.prop('disabled', false);
            this.updateSendExperience();
        }
    }

    async sendTemplateMessage() {
        const conversation = this.state.currentConversation;
        if (!conversation) {
             this.showNotification('Eroare', 'Vă rugăm selectați o conversație mai întâi.', 'error');
            return;
        }

        const templateMessage = prompt("Introduceți textul mesajului template pe care doriți să-l trimiteți:", "Bună ziua! Am încercat să vă contactăm în legătură cu solicitarea dumneavoastră.");

        if (!templateMessage || templateMessage.trim() === '') {
            this.showNotification('Info', 'Trimiterea template-ului a fost anulată.', 'info');
            return;
        }
        
        // Se folosește același endpoint ca pentru un mesaj normal, dar se marchează ca fiind template.
        // În acest caz, vom folosi direct APIService.sendMessage, deoarece logica e aceeași.
        this.showNotification('Info', 'Se trimite mesajul...', 'info');

        try {
            await APIService.sendMessage(
                conversation.id,
                templateMessage,
                conversation.phone,
                this.state.currentUser.id
            );

            this.showNotification('Succes', 'Mesajul a fost trimis cu succes.', 'success');
            
            // Reîmprospătează mesajele pentru a afișa template-ul trimis
            setTimeout(() => this.loadMessages(conversation.id, 1, true), 1500);

        } catch (error) {
            console.error('Eroare la trimiterea mesajului (template-style):', error);
            this.showNotification('Eroare', `Nu s-a putut trimite mesajul: ${error.message}`, 'error');
        }
    }

    showConversationsLoadingIndicator(isLoadMore = false) {
        if (isLoadMore) {
            // Afișează un spinner mai mic la finalul listei
            this.elements.conversationsList.append(`
                <div class="loading-state">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Se încarcă...</span>
                    </div>
                    <p>Se încarcă conversațiile...</p>
                </div>
            `);
        } else {
            // Afișăm starea de încărcare principală
            this.elements.conversationsList.html(`
                <div class="loading-state">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Se încarcă...</span>
                    </div>
                    <p>Se încarcă conversațiile...</p>
                </div>
            `);
        }
    }

    hideConversationsLoadingIndicator() {
        // Eliminăm starea de încărcare principală
        this.elements.conversationsList.find('.loading-state').remove();
    }

    async loadMoreConversations() {
        if (this.state.pagination.isLoading || !this.state.pagination.hasMore) {
            return;
        }

        console.log('--- Încărcare mai multe conversații ---');
        this.state.pagination.currentPage++;
        await this.loadConversations(true, false); // NU este un refresh, deci false
    }

    async handleIncomingMessage(leadId, messageContent, timestamp) {
        // Nu reîncărca totul, doar actualizează conversația specifică
        console.log(`🔔 Mesaj nou primit pentru lead ${leadId}. Se actualizează UI-ul...`);

        // 1. Găsește conversația existentă
        let conversation = this.state.conversations.find(c => c.id === leadId);

        if (conversation) {
            // --- CONVERSAȚIE EXISTENTĂ ---
            conversation.lastMessage = Utils.truncateText(messageContent, 60);
            conversation.lastActivity = timestamp;
            conversation.unreadCount = (conversation.unreadCount || 0) + 1;
            conversation.lastIncomingMessageTimestamp = timestamp; // Actualizăm data ultimului mesaj de la client
            
            // Dacă conversația este deschisă, marchează mesajul ca citit și adaugă-l în chat
            if (this.state.currentConversation && this.state.currentConversation.id === leadId) {
                await APIService.markMessagesAsRead(leadId);
                conversation.unreadCount = 0; 
                
                // Adaugă mesajul direct în UI fără a reîncărca totul
                const newMessage = {
                    id: `new_${Date.now()}`,
                    content: messageContent,
                    timestamp: timestamp,
                    type: 'incoming',
                    status: 'received',
                    read: true,
                    sentBy: 'Client'
                };

                const messageHtml = this.ui.getMessageHTML(newMessage);
                const lastMessageGroup = this.ui.elements.messagesContainer.find('.message-group').last();
                
                const todayStr = new Date().toLocaleDateString('ro-RO');
                const lastGroupDate = lastMessageGroup.find('.message-group-date').text();

                if (lastMessageGroup.length > 0 && lastGroupDate === todayStr) {
                    lastMessageGroup.append(messageHtml);
                } else {
                    // Dacă nu există grupuri de mesaje sau ultimul grup e din altă zi, creăm unul nou
                    const newGroup = $(`<div class="message-group"><div class="message-group-date">Astăzi</div></div>`);
                    newGroup.append(messageHtml);
                    this.ui.elements.messagesContainer.append(newGroup);
                }

                this.ui.scrollToBottom();

            }

        } else {
            // --- CONVERSAȚIE NOUĂ ---
            // Dacă este o conversație nouă, trebuie să o încărcăm complet
            console.log(`✨ Conversație nouă detectată (${leadId}). Se reîmprospătează lista.`);
            await this.loadConversations(false, true); // Reîmprospătare completă, dar silențioasă
            return; // Ieșim pentru a evita actualizări duble
        }
        
        // Sortează din nou conversațiile pentru a o aduce pe cea mai recentă în top
        this.state.conversations.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

        // Re-randează lista de conversații și actualizează statisticile
        this.state.updateStats();
        this.ui.renderConversations();
        this.ui.updateDashboardStats();

        // Redă un sunet de notificare
        if (this.state.settings.sounds) {
            const notificationSound = document.getElementById('notificationSound');
            if (notificationSound) {
                notificationSound.play().catch(e => console.warn("Nu s-a putut reda sunetul:", e));
            }
        }
    }

    showTemplateModal() {
        if (!this.state.currentConversation) {
            this.showNotification('Eroare', 'Vă rugăm selectați o conversație mai întâi.', 'error');
            return;
        }

        this.elements.templateSelector.empty().append('<option value="">Selectează un template...</option>');
        MESSAGE_TEMPLATES.forEach(template => {
            this.elements.templateSelector.append(`<option value="${template.name}">${template.displayName}</option>`);
        });

        this.updateTemplateDetails();
        this.elements.templateModal.addClass('show');
    }

    hideTemplateModal() {
        this.elements.templateModal.removeClass('show');
        this.elements.templateParamsContainer.empty();
        this.elements.templatePreview.text('');
    }

    updateTemplateDetails() {
        const selectedTemplateName = this.elements.templateSelector.val();
        const template = MESSAGE_TEMPLATES.find(t => t.name === selectedTemplateName);

        this.elements.templateParamsContainer.empty();
        if (!template || !template.params) {
            this.updateTemplatePreview();
            return;
        }

        template.params.forEach((param, index) => {
            const isNumeClient = param.toLowerCase().includes('nume') && param.toLowerCase().includes('client');
            const clientName = isNumeClient ? this.state.currentConversation.name : '';
            
            const paramInput = `
                <div class="form-group">
                    <label for="param_${index}">${param}</label>
                    <input type="text" id="param_${index}" class="form-control template-param" 
                           data-param-index="${index + 1}" value="${clientName}">
                </div>`;
            this.elements.templateParamsContainer.append(paramInput);
        });

        this.updateTemplatePreview();
    }

    updateTemplatePreview() {
        const selectedTemplateName = this.elements.templateSelector.val();
        const template = MESSAGE_TEMPLATES.find(t => t.name === selectedTemplateName);

        if (!template) {
            this.elements.templatePreview.text('');
            return;
        }

        let previewText = template.body;
        this.elements.templateParamsContainer.find('.template-param').each(function() {
            const index = $(this).data('param-index');
            const value = $(this).val() || `{{${index}}}`;
            previewText = previewText.replace(`{{${index}}}`, value);
        });

        this.elements.templatePreview.text(previewText);
    }

    async sendTemplateMessage() {
        const conversation = this.state.currentConversation;
        if (!conversation) {
             this.showNotification('Eroare', 'Vă rugăm selectați o conversație mai întâi.', 'error');
            return;
        }

        const templateMessage = prompt("Introduceți textul mesajului template pe care doriți să-l trimiteți:", "Bună ziua! Am încercat să vă contactăm în legătură cu solicitarea dumneavoastră.");

        if (!templateMessage || templateMessage.trim() === '') {
            this.showNotification('Info', 'Trimiterea template-ului a fost anulată.', 'info');
            return;
        }
        
        // Se folosește același endpoint ca pentru un mesaj normal, dar se marchează ca fiind template.
        // În acest caz, vom folosi direct APIService.sendMessage, deoarece logica e aceeași.
        this.showNotification('Info', 'Se trimite mesajul...', 'info');

        try {
            await APIService.sendMessage(
                conversation.id,
                templateMessage,
                conversation.phone,
                this.state.currentUser.id
            );

            this.showNotification('Succes', 'Mesajul a fost trimis cu succes.', 'success');
            
            // Reîmprospătează mesajele pentru a afișa template-ul trimis
            setTimeout(() => this.loadMessages(conversation.id, 1, true), 1500);

        } catch (error) {
            console.error('Eroare la trimiterea mesajului (template-style):', error);
            this.showNotification('Eroare', `Nu s-a putut trimite mesajul: ${error.message}`, 'error');
        }
    }
}

// === INIȚIALIZARE GLOBALĂ APLICAȚIE ===
(function() {
    // Creează starea globală
    const state = new WhatsAppState();
    // Creează UIManager cu starea
    const ui = new UIManager(state);
    // Atașează la window pentru debug și acces global
    window.app = {
        state,
        ui,
        loadConversations: async function(forceReload = false, reloadAgents = false) {
            if (forceReload) {
                state.conversations = [];
                state.pagination.currentPage = 1;
                state.pagination.hasMore = true;
            }
            if (reloadAgents) {
                state.agents = await loadAvailableAgents();
                ui.populateAgentDropdown();
                ui.populateAgentFilterDropdown(); // forțez popularea dropdown-ului
            }
            if (!state.currentUser) {
                state.currentUser = await getCurrentUser();
                // --- FIX: SETĂM VIZUALIZAREA DEFAULT PENTRU ADMIN ---
                if (state.currentUser.isSupervisor) {
                    state.viewMode = 'all';
                    // Actualizăm și vizual tab-ul activ
                    $('.view-mode-segment').removeClass('active');
                    $('.view-mode-segment[data-view="all"]').addClass('active');
                }
                // Apelăm update UI DUPĂ ce am aflat cine e user-ul
                ui.updateViewModeDisplay(); 
            }
            // Apelăm popularea dropdown-ului de filtrare aici, pentru a fi siguri că avem agenții încărcați
            if (state.currentUser && state.currentUser.isSupervisor) {
                ui.populateAgentFilterDropdown();
            }
            
            state.pagination.isLoading = true;
            try {
                let agentFilter = state.filters.agent;
                if (!CURRENT_USER.isSupervisor) agentFilter = undefined;
                const result = await APIService.loadConversations(
                    state.viewMode,
                    state.filters.leadCategory,
                    state.pagination.currentPage,
                    state.pagination.pageSize,
                    agentFilter
                );
                if (state.pagination.currentPage === 1) {
                    state.conversations = result.conversations;
                } else {
                    // DEDUPLICARE: actualizez sau adaug doar conversațiile noi
                    result.conversations.forEach(newConv => {
                        const idx = state.conversations.findIndex(c => c.id === newConv.id);
                        if (idx !== -1) {
                            state.conversations[idx] = newConv;
                        } else {
                            state.conversations.push(newConv);
                        }
                    });
                }
                state.pagination.hasMore = result.hasMore;
                state.pagination.totalLoaded = result.totalLoaded;
                state.pagination.isLoading = false;
                ui.renderConversations && ui.renderConversations();
                state.updateStats && state.updateStats();
                ui.updateDashboardStats && ui.updateDashboardStats();
            } catch (e) {
                state.pagination.isLoading = false;
                console.error('Eroare la încărcarea conversațiilor:', e);
            }
        },
        startRefreshTimer: function() {
            if (window._refreshTimer) clearInterval(window._refreshTimer);
            window._refreshTimer = setInterval(() => {
                if (window.app && typeof window.app.checkForNewMessages === 'function') {
                    window.app.checkForNewMessages();
                }
            }, window.app.state.settings.refreshInterval || 15000);
        },
        startMessagePolling: function() {
            if (window._messagePolling) clearInterval(window._messagePolling);
            window._messagePolling = setInterval(async () => {
                // Poți adăuga logica de polling pentru mesaje noi aici
            }, state.settings.messageCheckInterval || 5000);
        },
        loadMoreConversations: async function() {
            if (window.app.state.pagination.isLoading || !window.app.state.pagination.hasMore) {
                return;
            }
            window.app.state.pagination.currentPage++;
            await window.app.loadConversations(false, false);
        }
    };
    // Încarcă datele la pornire
    document.addEventListener('DOMContentLoaded', function() {
        window.app.loadConversations(true, true);
        window.app.startRefreshTimer();
        window.app.startMessagePolling();
    });
})();

// === DARK MODE TOGGLE LOGIC ===
function setupDarkModeToggle() {
    const darkModeToggle = document.getElementById('darkModeToggle');
    if (!darkModeToggle) return;
    // Inițializează starea la pornire
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
        darkModeToggle.checked = true;
    } else {
        document.body.classList.remove('dark-mode');
        darkModeToggle.checked = false;
    }
    darkModeToggle.addEventListener('change', function() {
        if (this.checked) {
            document.body.classList.add('dark-mode');
            localStorage.setItem('darkMode', 'true');
        } else {
            document.body.classList.remove('dark-mode');
            localStorage.setItem('darkMode', 'false');
        }
    });
}
// Asigură-te că se apelează la încărcarea paginii și la deschiderea modalului de setări
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDarkModeToggle);
} else {
    setupDarkModeToggle();
}
// Dacă modalul de setări se deschide dinamic, reatașează handlerul
const settingsBtn = document.getElementById('settingsBtn');
if (settingsBtn) {
    settingsBtn.addEventListener('click', function() {
        setTimeout(setupDarkModeToggle, 100); // asigură-te că elementul există
    });
}
// Adaug metoda checkForNewMessages pe window.app dacă nu există deja
if (!window.app.checkForNewMessages) {
    window.app.checkForNewMessages = async function() {
        try {
            const lastCheck = window.app.state.lastMessageCheck || new Date(Date.now() - 60000).toISOString();
            const newMessages = await APIService.checkForNewMessages(lastCheck);
            if (newMessages.length > 0) {
                for (const message of newMessages) {
                    if (window.app && window.app.ui && typeof window.app.ui.handleIncomingMessage === 'function') {
                        await window.app.ui.handleIncomingMessage(
                            message["_new_leadid_value"],
                            message.new_message,
                            message.new_timestamp
                        );
                    }
                }
            }
            window.app.state.lastMessageCheck = new Date().toISOString();
        } catch (error) {
            console.error('Eroare la polling mesaje noi:', error);
        }
    }
}
