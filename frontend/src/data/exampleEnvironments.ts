import type { Environment, QuickNorm, Dossier, DossierItem } from '../types';

// Helper to generate IDs
const generateId = () => Math.random().toString(36).substring(2, 15);

// Helper to create QuickNorm
const createQuickNorm = (
    label: string,
    act_type: string,
    article: string,
    act_number?: string,
    date?: string
): QuickNorm => ({
    id: generateId(),
    label,
    searchParams: {
        act_type,
        act_number: act_number || '',
        date: date || '',
        article,
        version: 'vigente',
        show_brocardi_info: false,
    },
    createdAt: new Date().toISOString(),
    usageCount: 0,
});

// Helper to create DossierItem from norm data
const createDossierItem = (
    tipo_atto: string,
    numero_articolo: string,
    numero_atto?: string,
    data?: string,
    status: DossierItem['status'] = 'unread'
): DossierItem => ({
    id: generateId(),
    type: 'norma',
    data: {
        tipo_atto,
        data: data || '',
        numero_atto: numero_atto || '',
        numero_articolo,
    },
    addedAt: new Date().toISOString(),
    status,
});

// Helper to create Dossier
const createDossier = (
    title: string,
    description: string,
    items: DossierItem[],
    tags: string[] = []
): Dossier => ({
    id: generateId(),
    title,
    description,
    createdAt: new Date().toISOString(),
    items,
    tags,
    isPinned: false,
});

// ============================================
// GDPR COMPLIANCE ENVIRONMENT
// ============================================
export const gdprEnvironment: Environment = {
    id: generateId(),
    name: 'GDPR & Privacy Compliance',
    description: 'Ambiente completo per la compliance GDPR con riferimenti al Regolamento UE 2016/679 e al Codice Privacy italiano (D.Lgs. 196/2003). Include i principali articoli su diritti degli interessati, basi giuridiche, obblighi informativi e sicurezza.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'compliance',
    color: '#3B82F6', // Blue
    tags: ['GDPR', 'privacy', 'data protection', 'compliance', 'DPO'],

    quickNorms: [
        // GDPR - Regolamento UE 2016/679 (num=679, year from date)
        createQuickNorm('Art. 5 GDPR - Principi del trattamento', 'regolamento ue', '5', '679', '2016-04-27'),
        createQuickNorm('Art. 6 GDPR - Basi giuridiche', 'regolamento ue', '6', '679', '2016-04-27'),
        createQuickNorm('Art. 7 GDPR - Condizioni per il consenso', 'regolamento ue', '7', '679', '2016-04-27'),
        createQuickNorm('Art. 13 GDPR - Informativa (dati raccolti)', 'regolamento ue', '13', '679', '2016-04-27'),
        createQuickNorm('Art. 14 GDPR - Informativa (dati da terzi)', 'regolamento ue', '14', '679', '2016-04-27'),
        createQuickNorm('Art. 15 GDPR - Diritto di accesso', 'regolamento ue', '15', '679', '2016-04-27'),
        createQuickNorm('Art. 17 GDPR - Diritto all\'oblio', 'regolamento ue', '17', '679', '2016-04-27'),
        createQuickNorm('Art. 20 GDPR - Portabilità dei dati', 'regolamento ue', '20', '679', '2016-04-27'),
        createQuickNorm('Art. 24 GDPR - Responsabilità del titolare', 'regolamento ue', '24', '679', '2016-04-27'),
        createQuickNorm('Art. 28 GDPR - Responsabile del trattamento', 'regolamento ue', '28', '679', '2016-04-27'),
        createQuickNorm('Art. 32 GDPR - Sicurezza del trattamento', 'regolamento ue', '32', '679', '2016-04-27'),
        createQuickNorm('Art. 33 GDPR - Data breach notification', 'regolamento ue', '33', '679', '2016-04-27'),
        // Codice Privacy italiano
        createQuickNorm('Art. 2-ter D.Lgs. 196/2003 - Base giuridica', 'decreto legislativo', '2 ter', '196', '2003-06-30'),
        createQuickNorm('Art. 2-sexies D.Lgs. 196/2003 - Dati particolari', 'decreto legislativo', '2 sexies', '196', '2003-06-30'),
    ],

    dossiers: [
        createDossier(
            'Diritti degli Interessati GDPR',
            'Articoli 15-22 del GDPR sui diritti fondamentali degli interessati',
            [
                createDossierItem('regolamento ue', '15', '679', '2016-04-27', 'important'),
                createDossierItem('regolamento ue', '16', '679', '2016-04-27'),
                createDossierItem('regolamento ue', '17', '679', '2016-04-27', 'important'),
                createDossierItem('regolamento ue', '18', '679', '2016-04-27'),
                createDossierItem('regolamento ue', '20', '679', '2016-04-27'),
                createDossierItem('regolamento ue', '21', '679', '2016-04-27'),
                createDossierItem('regolamento ue', '22', '679', '2016-04-27'),
            ],
            ['diritti', 'interessati', 'accesso', 'cancellazione']
        ),
        createDossier(
            'Obblighi Informativi',
            'Articoli 13-14 GDPR e requisiti per le informative privacy',
            [
                createDossierItem('regolamento ue', '13', '679', '2016-04-27', 'important'),
                createDossierItem('regolamento ue', '14', '679', '2016-04-27'),
            ],
            ['informativa', 'trasparenza']
        ),
        createDossier(
            'Data Breach e Sicurezza',
            'Gestione incidenti e misure di sicurezza secondo GDPR',
            [
                createDossierItem('regolamento ue', '32', '679', '2016-04-27', 'important'),
                createDossierItem('regolamento ue', '33', '679', '2016-04-27', 'important'),
                createDossierItem('regolamento ue', '34', '679', '2016-04-27'),
            ],
            ['sicurezza', 'data breach', 'notifica']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// DORA ENVIRONMENT
// ============================================
export const doraEnvironment: Environment = {
    id: generateId(),
    name: 'DORA - Digital Operational Resilience',
    description: 'Regolamento UE 2022/2554 sulla resilienza operativa digitale per il settore finanziario. Include governance ICT, gestione incidenti, test di resilienza e gestione fornitori terzi.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'compliance',
    color: '#8B5CF6', // Purple
    tags: ['DORA', 'fintech', 'banche', 'assicurazioni', 'ICT', 'cyber resilience'],

    quickNorms: [
        // Ambito e definizioni (num=2554, year from date)
        createQuickNorm('Art. 1 DORA - Oggetto', 'regolamento ue', '1', '2554', '2022-12-14'),
        createQuickNorm('Art. 2 DORA - Ambito di applicazione', 'regolamento ue', '2', '2554', '2022-12-14'),
        createQuickNorm('Art. 3 DORA - Definizioni', 'regolamento ue', '3', '2554', '2022-12-14'),
        // Governance e gestione rischi ICT
        createQuickNorm('Art. 5 DORA - Governance interna', 'regolamento ue', '5', '2554', '2022-12-14'),
        createQuickNorm('Art. 6 DORA - Quadro gestione rischi ICT', 'regolamento ue', '6', '2554', '2022-12-14'),
        createQuickNorm('Art. 9 DORA - Protezione e prevenzione', 'regolamento ue', '9', '2554', '2022-12-14'),
        createQuickNorm('Art. 11 DORA - Business continuity', 'regolamento ue', '11', '2554', '2022-12-14'),
        // Gestione incidenti
        createQuickNorm('Art. 17 DORA - Processo gestione incidenti', 'regolamento ue', '17', '2554', '2022-12-14'),
        createQuickNorm('Art. 18 DORA - Classificazione incidenti', 'regolamento ue', '18', '2554', '2022-12-14'),
        createQuickNorm('Art. 19 DORA - Segnalazione incidenti', 'regolamento ue', '19', '2554', '2022-12-14'),
        // Test di resilienza
        createQuickNorm('Art. 24 DORA - Requisiti test', 'regolamento ue', '24', '2554', '2022-12-14'),
        createQuickNorm('Art. 26 DORA - TLPT avanzati', 'regolamento ue', '26', '2554', '2022-12-14'),
        // Fornitori ICT terzi
        createQuickNorm('Art. 28 DORA - Principi gestione fornitori', 'regolamento ue', '28', '2554', '2022-12-14'),
        createQuickNorm('Art. 30 DORA - Clausole contrattuali', 'regolamento ue', '30', '2554', '2022-12-14'),
    ],

    dossiers: [
        createDossier(
            'Governance e Risk Management ICT',
            'Capo II DORA: quadro di governance e gestione dei rischi ICT (artt. 5-16)',
            [
                createDossierItem('regolamento ue', '5', '2554', '2022-12-14', 'important'),
                createDossierItem('regolamento ue', '6', '2554', '2022-12-14', 'important'),
                createDossierItem('regolamento ue', '7', '2554', '2022-12-14'),
                createDossierItem('regolamento ue', '8', '2554', '2022-12-14'),
                createDossierItem('regolamento ue', '9', '2554', '2022-12-14'),
                createDossierItem('regolamento ue', '10', '2554', '2022-12-14'),
                createDossierItem('regolamento ue', '11', '2554', '2022-12-14', 'important'),
                createDossierItem('regolamento ue', '12', '2554', '2022-12-14'),
            ],
            ['governance', 'rischio ICT', 'business continuity']
        ),
        createDossier(
            'Gestione e Segnalazione Incidenti ICT',
            'Capo III DORA: gestione, classificazione e segnalazione degli incidenti (artt. 17-23)',
            [
                createDossierItem('regolamento ue', '17', '2554', '2022-12-14', 'important'),
                createDossierItem('regolamento ue', '18', '2554', '2022-12-14'),
                createDossierItem('regolamento ue', '19', '2554', '2022-12-14', 'important'),
                createDossierItem('regolamento ue', '20', '2554', '2022-12-14'),
                createDossierItem('regolamento ue', '21', '2554', '2022-12-14'),
            ],
            ['incidenti', 'segnalazione', 'notifica']
        ),
        createDossier(
            'Gestione Fornitori ICT Terzi',
            'Capo V DORA: principi generali, registro, clausole contrattuali e sorveglianza (artt. 28-44)',
            [
                createDossierItem('regolamento ue', '28', '2554', '2022-12-14', 'important'),
                createDossierItem('regolamento ue', '29', '2554', '2022-12-14'),
                createDossierItem('regolamento ue', '30', '2554', '2022-12-14', 'important'),
                createDossierItem('regolamento ue', '31', '2554', '2022-12-14'),
            ],
            ['outsourcing', 'fornitori', 'contratti', 'terze parti']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// AI ACT ENVIRONMENT
// ============================================
export const aiActEnvironment: Environment = {
    id: generateId(),
    name: 'AI Act - Intelligenza Artificiale',
    description: 'Regolamento UE 2024/1689 sull\'intelligenza artificiale. Framework basato sul rischio con pratiche vietate, sistemi ad alto rischio, obblighi di trasparenza e governance.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'eu',
    color: '#10B981', // Green
    tags: ['AI Act', 'intelligenza artificiale', 'machine learning', 'alto rischio', 'compliance'],

    quickNorms: [
        // Disposizioni generali (num=1689, year from date)
        createQuickNorm('Art. 1 AI Act - Oggetto', 'regolamento ue', '1', '1689', '2024-07-12'),
        createQuickNorm('Art. 2 AI Act - Ambito di applicazione', 'regolamento ue', '2', '1689', '2024-07-12'),
        createQuickNorm('Art. 3 AI Act - Definizioni', 'regolamento ue', '3', '1689', '2024-07-12'),
        // Pratiche vietate
        createQuickNorm('Art. 5 AI Act - Pratiche vietate', 'regolamento ue', '5', '1689', '2024-07-12'),
        // Sistemi ad alto rischio
        createQuickNorm('Art. 6 AI Act - Classificazione alto rischio', 'regolamento ue', '6', '1689', '2024-07-12'),
        createQuickNorm('Art. 9 AI Act - Sistema gestione rischi', 'regolamento ue', '9', '1689', '2024-07-12'),
        createQuickNorm('Art. 10 AI Act - Dati e governance', 'regolamento ue', '10', '1689', '2024-07-12'),
        createQuickNorm('Art. 13 AI Act - Trasparenza', 'regolamento ue', '13', '1689', '2024-07-12'),
        createQuickNorm('Art. 14 AI Act - Sorveglianza umana', 'regolamento ue', '14', '1689', '2024-07-12'),
        createQuickNorm('Art. 15 AI Act - Accuratezza e robustezza', 'regolamento ue', '15', '1689', '2024-07-12'),
        // Obblighi fornitori
        createQuickNorm('Art. 16 AI Act - Obblighi fornitori', 'regolamento ue', '16', '1689', '2024-07-12'),
        createQuickNorm('Art. 17 AI Act - Sistema qualità', 'regolamento ue', '17', '1689', '2024-07-12'),
        // Obblighi deployer
        createQuickNorm('Art. 26 AI Act - Obblighi deployer', 'regolamento ue', '26', '1689', '2024-07-12'),
        // Sanzioni
        createQuickNorm('Art. 99 AI Act - Sanzioni', 'regolamento ue', '99', '1689', '2024-07-12'),
    ],

    dossiers: [
        createDossier(
            'Pratiche IA Vietate',
            'Art. 5 AI Act: sistemi IA proibiti (manipolazione, social scoring, biometria)',
            [
                createDossierItem('regolamento ue', '5', '1689', '2024-07-12', 'important'),
            ],
            ['divieti', 'pratiche vietate', 'biometria']
        ),
        createDossier(
            'Sistemi IA ad Alto Rischio',
            'Capo III AI Act: requisiti per i sistemi di IA ad alto rischio (artt. 6-15)',
            [
                createDossierItem('regolamento ue', '6', '1689', '2024-07-12', 'important'),
                createDossierItem('regolamento ue', '7', '1689', '2024-07-12'),
                createDossierItem('regolamento ue', '8', '1689', '2024-07-12'),
                createDossierItem('regolamento ue', '9', '1689', '2024-07-12', 'important'),
                createDossierItem('regolamento ue', '10', '1689', '2024-07-12', 'important'),
                createDossierItem('regolamento ue', '13', '1689', '2024-07-12'),
                createDossierItem('regolamento ue', '14', '1689', '2024-07-12', 'important'),
                createDossierItem('regolamento ue', '15', '1689', '2024-07-12'),
            ],
            ['alto rischio', 'requisiti', 'trasparenza', 'sorveglianza umana']
        ),
        createDossier(
            'Obblighi Operatori',
            'Obblighi per fornitori (provider) e deployer di sistemi IA',
            [
                createDossierItem('regolamento ue', '16', '1689', '2024-07-12', 'important'),
                createDossierItem('regolamento ue', '17', '1689', '2024-07-12'),
                createDossierItem('regolamento ue', '26', '1689', '2024-07-12', 'important'),
                createDossierItem('regolamento ue', '27', '1689', '2024-07-12'),
            ],
            ['fornitori', 'deployer', 'obblighi']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// CONSUMER LAW ENVIRONMENT
// ============================================
export const consumerLawEnvironment: Environment = {
    id: generateId(),
    name: 'Diritto dei Consumatori',
    description: 'Codice del Consumo (D.Lgs. 206/2005): diritti fondamentali, pratiche commerciali scorrette, garanzie, contratti a distanza e recesso. Essenziale per e-commerce e retail.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'civil',
    color: '#F59E0B', // Amber
    tags: ['consumatori', 'e-commerce', 'garanzie', 'recesso', 'pratiche commerciali'],

    quickNorms: [
        // Diritti fondamentali
        createQuickNorm('Art. 2 CdC - Diritti dei consumatori', 'decreto legislativo', '2', '206', '2005-09-06'),
        createQuickNorm('Art. 3 CdC - Definizioni', 'decreto legislativo', '3', '206', '2005-09-06'),
        // Informazioni
        createQuickNorm('Art. 5 CdC - Obblighi informativi', 'decreto legislativo', '5', '206', '2005-09-06'),
        createQuickNorm('Art. 6 CdC - Contenuto informazioni', 'decreto legislativo', '6', '206', '2005-09-06'),
        // Pratiche commerciali scorrette
        createQuickNorm('Art. 20 CdC - Divieto pratiche scorrette', 'decreto legislativo', '20', '206', '2005-09-06'),
        createQuickNorm('Art. 21 CdC - Azioni ingannevoli', 'decreto legislativo', '21', '206', '2005-09-06'),
        createQuickNorm('Art. 22 CdC - Omissioni ingannevoli', 'decreto legislativo', '22', '206', '2005-09-06'),
        createQuickNorm('Art. 24 CdC - Pratiche aggressive', 'decreto legislativo', '24', '206', '2005-09-06'),
        // Contratti a distanza
        createQuickNorm('Art. 49 CdC - Obblighi informativi contratti distanza', 'decreto legislativo', '49', '206', '2005-09-06'),
        createQuickNorm('Art. 52 CdC - Diritto di recesso', 'decreto legislativo', '52', '206', '2005-09-06'),
        createQuickNorm('Art. 54 CdC - Esercizio recesso', 'decreto legislativo', '54', '206', '2005-09-06'),
        createQuickNorm('Art. 56 CdC - Obblighi professionista nel recesso', 'decreto legislativo', '56', '206', '2005-09-06'),
        // Garanzie
        createQuickNorm('Art. 128 CdC - Ambito garanzia', 'decreto legislativo', '128', '206', '2005-09-06'),
        createQuickNorm('Art. 129 CdC - Conformità al contratto', 'decreto legislativo', '129', '206', '2005-09-06'),
        createQuickNorm('Art. 130 CdC - Diritti del consumatore', 'decreto legislativo', '130', '206', '2005-09-06'),
        createQuickNorm('Art. 132 CdC - Termini garanzia', 'decreto legislativo', '132', '206', '2005-09-06'),
    ],

    dossiers: [
        createDossier(
            'Diritti Fondamentali del Consumatore',
            'Parte I Codice del Consumo: diritti irrinunciabili e definizioni',
            [
                createDossierItem('decreto legislativo', '2', '206', '2005-09-06', 'important'),
                createDossierItem('decreto legislativo', '3', '206', '2005-09-06'),
                createDossierItem('decreto legislativo', '5', '206', '2005-09-06'),
                createDossierItem('decreto legislativo', '6', '206', '2005-09-06'),
            ],
            ['diritti', 'definizioni', 'informazioni']
        ),
        createDossier(
            'Pratiche Commerciali Scorrette',
            'Titolo III Codice del Consumo: divieto e tipologie di pratiche vietate (artt. 20-27)',
            [
                createDossierItem('decreto legislativo', '20', '206', '2005-09-06', 'important'),
                createDossierItem('decreto legislativo', '21', '206', '2005-09-06', 'important'),
                createDossierItem('decreto legislativo', '22', '206', '2005-09-06'),
                createDossierItem('decreto legislativo', '23', '206', '2005-09-06'),
                createDossierItem('decreto legislativo', '24', '206', '2005-09-06'),
                createDossierItem('decreto legislativo', '25', '206', '2005-09-06'),
                createDossierItem('decreto legislativo', '26', '206', '2005-09-06'),
            ],
            ['pratiche scorrette', 'pubblicità ingannevole', 'aggressività']
        ),
        createDossier(
            'E-commerce e Contratti a Distanza',
            'Capo I Titolo III: obblighi informativi, diritto di recesso e modalità',
            [
                createDossierItem('decreto legislativo', '49', '206', '2005-09-06', 'important'),
                createDossierItem('decreto legislativo', '50', '206', '2005-09-06'),
                createDossierItem('decreto legislativo', '51', '206', '2005-09-06'),
                createDossierItem('decreto legislativo', '52', '206', '2005-09-06', 'important'),
                createDossierItem('decreto legislativo', '53', '206', '2005-09-06'),
                createDossierItem('decreto legislativo', '54', '206', '2005-09-06'),
                createDossierItem('decreto legislativo', '56', '206', '2005-09-06'),
                createDossierItem('decreto legislativo', '57', '206', '2005-09-06'),
            ],
            ['e-commerce', 'recesso', 'contratti a distanza', '14 giorni']
        ),
        createDossier(
            'Garanzia Legale di Conformità',
            'Titolo III Capo I: garanzia biennale sui beni di consumo (artt. 128-135)',
            [
                createDossierItem('decreto legislativo', '128', '206', '2005-09-06'),
                createDossierItem('decreto legislativo', '129', '206', '2005-09-06', 'important'),
                createDossierItem('decreto legislativo', '130', '206', '2005-09-06', 'important'),
                createDossierItem('decreto legislativo', '131', '206', '2005-09-06'),
                createDossierItem('decreto legislativo', '132', '206', '2005-09-06', 'important'),
                createDossierItem('decreto legislativo', '133', '206', '2005-09-06'),
                createDossierItem('decreto legislativo', '134', '206', '2005-09-06'),
                createDossierItem('decreto legislativo', '135', '206', '2005-09-06'),
            ],
            ['garanzia', 'conformità', '2 anni', 'difetti']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// CODICE PENALE - PARTE GENERALE
// ============================================
export const codicePenaleGeneraleEnvironment: Environment = {
    id: generateId(),
    name: 'Codice Penale - Parte Generale',
    description: 'Parte generale del Codice Penale italiano: principio di legalità, elemento soggettivo del reato, cause di giustificazione, tentativo e concorso di persone nel reato.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'penal',
    color: '#EF4444', // Red
    tags: ['penale', 'legalità', 'dolo', 'colpa', 'tentativo', 'concorso'],

    quickNorms: [
        // Principi fondamentali
        createQuickNorm('Art. 1 CP - Reati e pene', 'codice penale', '1'),
        createQuickNorm('Art. 2 CP - Successione leggi penali', 'codice penale', '2'),
        createQuickNorm('Art. 3 CP - Obbligatorietà legge penale', 'codice penale', '3'),
        // Elemento soggettivo
        createQuickNorm('Art. 40 CP - Rapporto di causalità', 'codice penale', '40'),
        createQuickNorm('Art. 41 CP - Concorso di cause', 'codice penale', '41'),
        createQuickNorm('Art. 42 CP - Responsabilità per dolo o colpa', 'codice penale', '42'),
        createQuickNorm('Art. 43 CP - Elemento psicologico', 'codice penale', '43'),
        // Cause di giustificazione
        createQuickNorm('Art. 50 CP - Consenso dell\'avente diritto', 'codice penale', '50'),
        createQuickNorm('Art. 51 CP - Esercizio di un diritto', 'codice penale', '51'),
        createQuickNorm('Art. 52 CP - Difesa legittima', 'codice penale', '52'),
        createQuickNorm('Art. 54 CP - Stato di necessità', 'codice penale', '54'),
        // Tentativo
        createQuickNorm('Art. 56 CP - Delitto tentato', 'codice penale', '56'),
        // Concorso di persone
        createQuickNorm('Art. 110 CP - Pena per concorso', 'codice penale', '110'),
        createQuickNorm('Art. 114 CP - Circostanze attenuanti', 'codice penale', '114'),
        createQuickNorm('Art. 116 CP - Reato diverso da quello voluto', 'codice penale', '116'),
    ],

    dossiers: [
        createDossier(
            'Principio di Legalità',
            'Fondamenti del diritto penale: nulla poena sine lege (artt. 1-16 CP)',
            [
                createDossierItem('codice penale', '1', undefined, undefined, 'important'),
                createDossierItem('codice penale', '2'),
                createDossierItem('codice penale', '3'),
                createDossierItem('codice penale', '5'),
                createDossierItem('codice penale', '14'),
            ],
            ['legalità', 'principi', 'irretroattività']
        ),
        createDossier(
            'Elemento Soggettivo del Reato',
            'Dolo, colpa, preterintenzione e rapporto di causalità (artt. 40-49 CP)',
            [
                createDossierItem('codice penale', '40', undefined, undefined, 'important'),
                createDossierItem('codice penale', '41'),
                createDossierItem('codice penale', '42', undefined, undefined, 'important'),
                createDossierItem('codice penale', '43', undefined, undefined, 'important'),
                createDossierItem('codice penale', '45'),
                createDossierItem('codice penale', '47'),
            ],
            ['dolo', 'colpa', 'causalità', 'elemento soggettivo']
        ),
        createDossier(
            'Cause di Giustificazione',
            'Scriminanti che escludono l\'antigiuridicità (artt. 50-54 CP)',
            [
                createDossierItem('codice penale', '50'),
                createDossierItem('codice penale', '51'),
                createDossierItem('codice penale', '52', undefined, undefined, 'important'),
                createDossierItem('codice penale', '53'),
                createDossierItem('codice penale', '54', undefined, undefined, 'important'),
            ],
            ['scriminanti', 'legittima difesa', 'stato necessità']
        ),
        createDossier(
            'Concorso di Persone nel Reato',
            'Disciplina del concorso di persone (artt. 110-119 CP)',
            [
                createDossierItem('codice penale', '110', undefined, undefined, 'important'),
                createDossierItem('codice penale', '111'),
                createDossierItem('codice penale', '112'),
                createDossierItem('codice penale', '114'),
                createDossierItem('codice penale', '116'),
                createDossierItem('codice penale', '117'),
                createDossierItem('codice penale', '119'),
            ],
            ['concorso', 'partecipazione', 'compartecipazione']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// CODICE PENALE - REATI PRINCIPALI
// ============================================
export const codicePenaleReatiEnvironment: Environment = {
    id: generateId(),
    name: 'Codice Penale - Reati Principali',
    description: 'I principali reati del Codice Penale: delitti contro la persona (omicidio, lesioni, reati sessuali) e contro il patrimonio (furto, rapina, truffa, appropriazione indebita).',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'penal',
    color: '#DC2626', // Dark Red
    tags: ['penale', 'omicidio', 'lesioni', 'furto', 'rapina', 'truffa'],

    quickNorms: [
        // Delitti contro la persona
        createQuickNorm('Art. 575 CP - Omicidio', 'codice penale', '575'),
        createQuickNorm('Art. 576 CP - Circostanze aggravanti', 'codice penale', '576'),
        createQuickNorm('Art. 582 CP - Lesione personale', 'codice penale', '582'),
        createQuickNorm('Art. 590 CP - Lesioni colpose', 'codice penale', '590'),
        createQuickNorm('Art. 609 bis CP - Violenza sessuale', 'codice penale', '609 bis'),
        createQuickNorm('Art. 612 bis CP - Atti persecutori (stalking)', 'codice penale', '612 bis'),
        // Delitti contro il patrimonio
        createQuickNorm('Art. 624 CP - Furto', 'codice penale', '624'),
        createQuickNorm('Art. 625 CP - Circostanze aggravanti furto', 'codice penale', '625'),
        createQuickNorm('Art. 628 CP - Rapina', 'codice penale', '628'),
        createQuickNorm('Art. 629 CP - Estorsione', 'codice penale', '629'),
        createQuickNorm('Art. 640 CP - Truffa', 'codice penale', '640'),
        createQuickNorm('Art. 646 CP - Appropriazione indebita', 'codice penale', '646'),
        createQuickNorm('Art. 648 CP - Ricettazione', 'codice penale', '648'),
        createQuickNorm('Art. 648 bis CP - Riciclaggio', 'codice penale', '648 bis'),
    ],

    dossiers: [
        createDossier(
            'Delitti contro la Vita e l\'Incolumità',
            'Omicidio, lesioni personali e reati correlati (artt. 575-593 CP)',
            [
                createDossierItem('codice penale', '575', undefined, undefined, 'important'),
                createDossierItem('codice penale', '576'),
                createDossierItem('codice penale', '577'),
                createDossierItem('codice penale', '582', undefined, undefined, 'important'),
                createDossierItem('codice penale', '583'),
                createDossierItem('codice penale', '589'),
                createDossierItem('codice penale', '590'),
            ],
            ['omicidio', 'lesioni', 'morte', 'incolumità']
        ),
        createDossier(
            'Delitti contro la Libertà Personale',
            'Reati sessuali, sequestro, stalking (artt. 605-612 bis CP)',
            [
                createDossierItem('codice penale', '605'),
                createDossierItem('codice penale', '609 bis', undefined, undefined, 'important'),
                createDossierItem('codice penale', '609 ter'),
                createDossierItem('codice penale', '609 quater'),
                createDossierItem('codice penale', '610'),
                createDossierItem('codice penale', '612 bis', undefined, undefined, 'important'),
            ],
            ['violenza sessuale', 'stalking', 'sequestro', 'libertà']
        ),
        createDossier(
            'Delitti contro il Patrimonio mediante Violenza',
            'Furto, rapina, estorsione (artt. 624-631 CP)',
            [
                createDossierItem('codice penale', '624', undefined, undefined, 'important'),
                createDossierItem('codice penale', '625'),
                createDossierItem('codice penale', '628', undefined, undefined, 'important'),
                createDossierItem('codice penale', '629'),
                createDossierItem('codice penale', '630'),
            ],
            ['furto', 'rapina', 'estorsione', 'patrimonio']
        ),
        createDossier(
            'Delitti contro il Patrimonio mediante Frode',
            'Truffa, appropriazione indebita, ricettazione, riciclaggio (artt. 640-648 CP)',
            [
                createDossierItem('codice penale', '640', undefined, undefined, 'important'),
                createDossierItem('codice penale', '641'),
                createDossierItem('codice penale', '646', undefined, undefined, 'important'),
                createDossierItem('codice penale', '648'),
                createDossierItem('codice penale', '648 bis', undefined, undefined, 'important'),
                createDossierItem('codice penale', '648 ter'),
            ],
            ['truffa', 'frode', 'riciclaggio', 'ricettazione']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// CODICE CIVILE - OBBLIGAZIONI E CONTRATTI
// ============================================
export const codiceCivileObbligazioniEnvironment: Environment = {
    id: generateId(),
    name: 'Codice Civile - Obbligazioni e Contratti',
    description: 'Libro IV del Codice Civile: fonti delle obbligazioni, teoria generale del contratto, formazione, interpretazione, inadempimento e risoluzione.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'civil',
    color: '#2563EB', // Blue
    tags: ['obbligazioni', 'contratti', 'inadempimento', 'risoluzione'],

    quickNorms: [
        // Fonti delle obbligazioni
        createQuickNorm('Art. 1173 CC - Fonti delle obbligazioni', 'codice civile', '1173'),
        createQuickNorm('Art. 1174 CC - Carattere patrimoniale', 'codice civile', '1174'),
        createQuickNorm('Art. 1175 CC - Comportamento correttezza', 'codice civile', '1175'),
        createQuickNorm('Art. 1176 CC - Diligenza nell\'adempimento', 'codice civile', '1176'),
        // Inadempimento
        createQuickNorm('Art. 1218 CC - Responsabilità del debitore', 'codice civile', '1218'),
        createQuickNorm('Art. 1223 CC - Risarcimento del danno', 'codice civile', '1223'),
        createQuickNorm('Art. 1227 CC - Concorso del creditore', 'codice civile', '1227'),
        // Teoria del contratto
        createQuickNorm('Art. 1321 CC - Nozione di contratto', 'codice civile', '1321'),
        createQuickNorm('Art. 1322 CC - Autonomia contrattuale', 'codice civile', '1322'),
        createQuickNorm('Art. 1325 CC - Requisiti del contratto', 'codice civile', '1325'),
        createQuickNorm('Art. 1326 CC - Conclusione del contratto', 'codice civile', '1326'),
        // Interpretazione
        createQuickNorm('Art. 1362 CC - Intenzione dei contraenti', 'codice civile', '1362'),
        createQuickNorm('Art. 1366 CC - Interpretazione buona fede', 'codice civile', '1366'),
        // Risoluzione
        createQuickNorm('Art. 1453 CC - Risolubilità del contratto', 'codice civile', '1453'),
        createQuickNorm('Art. 1455 CC - Importanza inadempimento', 'codice civile', '1455'),
        createQuickNorm('Art. 1460 CC - Eccezione inadempimento', 'codice civile', '1460'),
    ],

    dossiers: [
        createDossier(
            'Fonti delle Obbligazioni',
            'Le obbligazioni nascono da contratto, fatto illecito o altro (artt. 1173-1200 CC)',
            [
                createDossierItem('codice civile', '1173', undefined, undefined, 'important'),
                createDossierItem('codice civile', '1174'),
                createDossierItem('codice civile', '1175'),
                createDossierItem('codice civile', '1176', undefined, undefined, 'important'),
                createDossierItem('codice civile', '1177'),
                createDossierItem('codice civile', '1182'),
            ],
            ['obbligazioni', 'fonti', 'diligenza']
        ),
        createDossier(
            'Inadempimento e Responsabilità',
            'Disciplina dell\'inadempimento delle obbligazioni (artt. 1218-1229 CC)',
            [
                createDossierItem('codice civile', '1218', undefined, undefined, 'important'),
                createDossierItem('codice civile', '1219'),
                createDossierItem('codice civile', '1223', undefined, undefined, 'important'),
                createDossierItem('codice civile', '1224'),
                createDossierItem('codice civile', '1225'),
                createDossierItem('codice civile', '1227'),
                createDossierItem('codice civile', '1229'),
            ],
            ['inadempimento', 'responsabilità', 'risarcimento', 'mora']
        ),
        createDossier(
            'Formazione del Contratto',
            'Requisiti, conclusione, forma (artt. 1321-1352 CC)',
            [
                createDossierItem('codice civile', '1321', undefined, undefined, 'important'),
                createDossierItem('codice civile', '1322', undefined, undefined, 'important'),
                createDossierItem('codice civile', '1325'),
                createDossierItem('codice civile', '1326'),
                createDossierItem('codice civile', '1327'),
                createDossierItem('codice civile', '1337'),
                createDossierItem('codice civile', '1341'),
                createDossierItem('codice civile', '1350'),
            ],
            ['contratto', 'formazione', 'autonomia', 'forma']
        ),
        createDossier(
            'Risoluzione del Contratto',
            'Risoluzione per inadempimento, impossibilità, eccessiva onerosità (artt. 1453-1469 CC)',
            [
                createDossierItem('codice civile', '1453', undefined, undefined, 'important'),
                createDossierItem('codice civile', '1454'),
                createDossierItem('codice civile', '1455', undefined, undefined, 'important'),
                createDossierItem('codice civile', '1456'),
                createDossierItem('codice civile', '1457'),
                createDossierItem('codice civile', '1460'),
                createDossierItem('codice civile', '1463'),
                createDossierItem('codice civile', '1467'),
            ],
            ['risoluzione', 'inadempimento', 'diffida', 'eccezione']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// CODICE CIVILE - RESPONSABILITÀ CIVILE
// ============================================
export const codiceCivileResponsabilitaEnvironment: Environment = {
    id: generateId(),
    name: 'Codice Civile - Responsabilità Civile',
    description: 'Responsabilità extracontrattuale: fatto illecito, responsabilità oggettiva, danno risarcibile, danno patrimoniale e non patrimoniale.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'civil',
    color: '#7C3AED', // Violet
    tags: ['responsabilità', 'illecito', 'danno', 'risarcimento', 'aquiliana'],

    quickNorms: [
        // Responsabilità per fatto illecito
        createQuickNorm('Art. 2043 CC - Risarcimento fatto illecito', 'codice civile', '2043'),
        createQuickNorm('Art. 2044 CC - Legittima difesa', 'codice civile', '2044'),
        createQuickNorm('Art. 2045 CC - Stato di necessità', 'codice civile', '2045'),
        createQuickNorm('Art. 2046 CC - Imputabilità', 'codice civile', '2046'),
        createQuickNorm('Art. 2047 CC - Danno incapace', 'codice civile', '2047'),
        // Responsabilità oggettiva
        createQuickNorm('Art. 2048 CC - Responsabilità genitori', 'codice civile', '2048'),
        createQuickNorm('Art. 2049 CC - Responsabilità padroni', 'codice civile', '2049'),
        createQuickNorm('Art. 2050 CC - Attività pericolose', 'codice civile', '2050'),
        createQuickNorm('Art. 2051 CC - Danno da cose in custodia', 'codice civile', '2051'),
        createQuickNorm('Art. 2052 CC - Danno da animali', 'codice civile', '2052'),
        createQuickNorm('Art. 2053 CC - Rovina di edificio', 'codice civile', '2053'),
        createQuickNorm('Art. 2054 CC - Circolazione veicoli', 'codice civile', '2054'),
        // Danno risarcibile
        createQuickNorm('Art. 2056 CC - Valutazione del danno', 'codice civile', '2056'),
        createQuickNorm('Art. 2058 CC - Risarcimento in forma specifica', 'codice civile', '2058'),
        createQuickNorm('Art. 2059 CC - Danni non patrimoniali', 'codice civile', '2059'),
    ],

    dossiers: [
        createDossier(
            'Responsabilità per Fatto Illecito',
            'Clausola generale e requisiti dell\'illecito civile (artt. 2043-2046 CC)',
            [
                createDossierItem('codice civile', '2043', undefined, undefined, 'important'),
                createDossierItem('codice civile', '2044'),
                createDossierItem('codice civile', '2045'),
                createDossierItem('codice civile', '2046'),
            ],
            ['illecito', 'colpa', 'dolo', '2043']
        ),
        createDossier(
            'Responsabilità Oggettiva e Indiretta',
            'Responsabilità senza colpa: genitori, datori, custodi (artt. 2047-2054 CC)',
            [
                createDossierItem('codice civile', '2047'),
                createDossierItem('codice civile', '2048', undefined, undefined, 'important'),
                createDossierItem('codice civile', '2049', undefined, undefined, 'important'),
                createDossierItem('codice civile', '2050'),
                createDossierItem('codice civile', '2051', undefined, undefined, 'important'),
                createDossierItem('codice civile', '2052'),
                createDossierItem('codice civile', '2053'),
                createDossierItem('codice civile', '2054', undefined, undefined, 'important'),
            ],
            ['responsabilità oggettiva', 'custodia', 'circolazione', 'vicario']
        ),
        createDossier(
            'Danno Risarcibile',
            'Quantificazione del danno e risarcimento (artt. 2056-2059 CC)',
            [
                createDossierItem('codice civile', '2056', undefined, undefined, 'important'),
                createDossierItem('codice civile', '2057'),
                createDossierItem('codice civile', '2058'),
                createDossierItem('codice civile', '2059', undefined, undefined, 'important'),
            ],
            ['danno', 'risarcimento', 'non patrimoniale', 'biologico']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// CODICE CIVILE - PROPRIETÀ E DIRITTI REALI
// ============================================
export const codiceCivileProprietaEnvironment: Environment = {
    id: generateId(),
    name: 'Codice Civile - Proprietà e Diritti Reali',
    description: 'Libro III del Codice Civile: proprietà, possesso, usucapione, comunione, condominio e diritti reali di godimento.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'civil',
    color: '#059669', // Emerald
    tags: ['proprietà', 'possesso', 'usucapione', 'condominio', 'diritti reali'],

    quickNorms: [
        // Proprietà
        createQuickNorm('Art. 832 CC - Contenuto diritto proprietà', 'codice civile', '832'),
        createQuickNorm('Art. 833 CC - Atti emulativi', 'codice civile', '833'),
        createQuickNorm('Art. 840 CC - Sottosuolo e soprassuolo', 'codice civile', '840'),
        createQuickNorm('Art. 844 CC - Immissioni', 'codice civile', '844'),
        // Modi di acquisto
        createQuickNorm('Art. 922 CC - Modi acquisto proprietà', 'codice civile', '922'),
        createQuickNorm('Art. 934 CC - Accessione', 'codice civile', '934'),
        createQuickNorm('Art. 1158 CC - Usucapione ordinaria', 'codice civile', '1158'),
        createQuickNorm('Art. 1159 CC - Usucapione beni mobili', 'codice civile', '1159'),
        // Azioni a difesa
        createQuickNorm('Art. 948 CC - Azione di rivendicazione', 'codice civile', '948'),
        createQuickNorm('Art. 949 CC - Azione negatoria', 'codice civile', '949'),
        // Comunione e condominio
        createQuickNorm('Art. 1100 CC - Norme sulla comunione', 'codice civile', '1100'),
        createQuickNorm('Art. 1102 CC - Uso della cosa comune', 'codice civile', '1102'),
        createQuickNorm('Art. 1117 CC - Parti comuni condominio', 'codice civile', '1117'),
        createQuickNorm('Art. 1118 CC - Diritti dei condomini', 'codice civile', '1118'),
        createQuickNorm('Art. 1120 CC - Innovazioni', 'codice civile', '1120'),
        createQuickNorm('Art. 1136 CC - Costituzione assemblea', 'codice civile', '1136'),
    ],

    dossiers: [
        createDossier(
            'La Proprietà',
            'Contenuto, limiti e tutela del diritto di proprietà (artt. 832-951 CC)',
            [
                createDossierItem('codice civile', '832', undefined, undefined, 'important'),
                createDossierItem('codice civile', '833'),
                createDossierItem('codice civile', '834'),
                createDossierItem('codice civile', '840'),
                createDossierItem('codice civile', '844', undefined, undefined, 'important'),
                createDossierItem('codice civile', '948'),
                createDossierItem('codice civile', '949'),
            ],
            ['proprietà', 'immissioni', 'rivendicazione', 'limiti']
        ),
        createDossier(
            'Modi di Acquisto della Proprietà',
            'Accessione, usucapione e altri modi di acquisto (artt. 922-947, 1158-1167 CC)',
            [
                createDossierItem('codice civile', '922'),
                createDossierItem('codice civile', '934'),
                createDossierItem('codice civile', '935'),
                createDossierItem('codice civile', '1158', undefined, undefined, 'important'),
                createDossierItem('codice civile', '1159'),
                createDossierItem('codice civile', '1159 bis'),
                createDossierItem('codice civile', '1161'),
            ],
            ['acquisto', 'usucapione', 'accessione', 'possesso']
        ),
        createDossier(
            'Condominio negli Edifici',
            'Disciplina del condominio e della comunione (artt. 1117-1139 CC)',
            [
                createDossierItem('codice civile', '1117', undefined, undefined, 'important'),
                createDossierItem('codice civile', '1118'),
                createDossierItem('codice civile', '1119'),
                createDossierItem('codice civile', '1120'),
                createDossierItem('codice civile', '1122'),
                createDossierItem('codice civile', '1130'),
                createDossierItem('codice civile', '1135'),
                createDossierItem('codice civile', '1136', undefined, undefined, 'important'),
                createDossierItem('codice civile', '1137'),
            ],
            ['condominio', 'assemblea', 'parti comuni', 'millesimi']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// CODICE CIVILE - FAMIGLIA E SUCCESSIONI
// ============================================
export const codiceCivileFamigliaEnvironment: Environment = {
    id: generateId(),
    name: 'Codice Civile - Famiglia e Successioni',
    description: 'Libro I e II del Codice Civile: matrimonio, diritti e doveri dei coniugi, filiazione, successioni legittime e testamentarie, legittima.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'civil',
    color: '#EC4899', // Pink
    tags: ['famiglia', 'matrimonio', 'filiazione', 'successioni', 'testamento'],

    quickNorms: [
        // Matrimonio e rapporti tra coniugi
        createQuickNorm('Art. 143 CC - Diritti e doveri dei coniugi', 'codice civile', '143'),
        createQuickNorm('Art. 144 CC - Indirizzo vita familiare', 'codice civile', '144'),
        createQuickNorm('Art. 147 CC - Doveri verso i figli', 'codice civile', '147'),
        createQuickNorm('Art. 151 CC - Separazione giudiziale', 'codice civile', '151'),
        // Filiazione
        createQuickNorm('Art. 315 CC - Stato giuridico filiazione', 'codice civile', '315'),
        createQuickNorm('Art. 315 bis CC - Diritti e doveri del figlio', 'codice civile', '315 bis'),
        createQuickNorm('Art. 316 CC - Responsabilità genitoriale', 'codice civile', '316'),
        createQuickNorm('Art. 337 ter CC - Affidamento dei figli', 'codice civile', '337 ter'),
        // Successioni
        createQuickNorm('Art. 456 CC - Apertura successione', 'codice civile', '456'),
        createQuickNorm('Art. 457 CC - Delazione ereditaria', 'codice civile', '457'),
        createQuickNorm('Art. 536 CC - Legittimari', 'codice civile', '536'),
        createQuickNorm('Art. 537 CC - Riserva figli', 'codice civile', '537'),
        createQuickNorm('Art. 540 CC - Riserva coniuge', 'codice civile', '540'),
        // Testamento
        createQuickNorm('Art. 587 CC - Testamento', 'codice civile', '587'),
        createQuickNorm('Art. 601 CC - Forme testamento', 'codice civile', '601'),
        createQuickNorm('Art. 602 CC - Testamento olografo', 'codice civile', '602'),
    ],

    dossiers: [
        createDossier(
            'Matrimonio e Rapporti Familiari',
            'Diritti e doveri dei coniugi, separazione (artt. 143-158 CC)',
            [
                createDossierItem('codice civile', '143', undefined, undefined, 'important'),
                createDossierItem('codice civile', '144'),
                createDossierItem('codice civile', '147'),
                createDossierItem('codice civile', '148'),
                createDossierItem('codice civile', '151', undefined, undefined, 'important'),
                createDossierItem('codice civile', '155'),
                createDossierItem('codice civile', '156'),
            ],
            ['matrimonio', 'coniugi', 'separazione', 'doveri']
        ),
        createDossier(
            'Filiazione e Responsabilità Genitoriale',
            'Status di figlio e affidamento (artt. 315-337 octies CC)',
            [
                createDossierItem('codice civile', '315', undefined, undefined, 'important'),
                createDossierItem('codice civile', '315 bis'),
                createDossierItem('codice civile', '316'),
                createDossierItem('codice civile', '316 bis'),
                createDossierItem('codice civile', '337 bis'),
                createDossierItem('codice civile', '337 ter', undefined, undefined, 'important'),
                createDossierItem('codice civile', '337 quater'),
            ],
            ['filiazione', 'affidamento', 'responsabilità genitoriale']
        ),
        createDossier(
            'Successioni e Legittima',
            'Apertura successione, eredi legittimi e legittimari (artt. 456-564 CC)',
            [
                createDossierItem('codice civile', '456'),
                createDossierItem('codice civile', '457', undefined, undefined, 'important'),
                createDossierItem('codice civile', '536', undefined, undefined, 'important'),
                createDossierItem('codice civile', '537'),
                createDossierItem('codice civile', '538'),
                createDossierItem('codice civile', '540'),
                createDossierItem('codice civile', '542'),
            ],
            ['successioni', 'legittima', 'legittimari', 'riserva']
        ),
        createDossier(
            'Testamento',
            'Forme, contenuto e invalidità del testamento (artt. 587-712 CC)',
            [
                createDossierItem('codice civile', '587', undefined, undefined, 'important'),
                createDossierItem('codice civile', '588'),
                createDossierItem('codice civile', '601'),
                createDossierItem('codice civile', '602', undefined, undefined, 'important'),
                createDossierItem('codice civile', '603'),
                createDossierItem('codice civile', '606'),
            ],
            ['testamento', 'olografo', 'pubblico', 'legato']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// PROCEDIMENTO AMMINISTRATIVO (L. 241/1990)
// ============================================
export const legge241Environment: Environment = {
    id: generateId(),
    name: 'Procedimento Amministrativo (L. 241/90)',
    description: 'Legge 241/1990 sul procedimento amministrativo: principi, partecipazione, responsabile del procedimento, conferenza servizi, autotutela e accesso agli atti.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'administrative',
    color: '#0891B2', // Cyan
    tags: ['procedimento', 'PA', 'SCIA', 'silenzio', 'accesso atti', 'autotutela'],

    quickNorms: [
        // Principi
        createQuickNorm('Art. 1 L.241/90 - Principi attività amministrativa', 'legge', '1', '241', '1990-08-07'),
        createQuickNorm('Art. 2 L.241/90 - Conclusione procedimento', 'legge', '2', '241', '1990-08-07'),
        createQuickNorm('Art. 3 L.241/90 - Motivazione provvedimento', 'legge', '3', '241', '1990-08-07'),
        // Responsabile
        createQuickNorm('Art. 4 L.241/90 - Unità organizzativa', 'legge', '4', '241', '1990-08-07'),
        createQuickNorm('Art. 5 L.241/90 - Responsabile procedimento', 'legge', '5', '241', '1990-08-07'),
        createQuickNorm('Art. 6 L.241/90 - Compiti responsabile', 'legge', '6', '241', '1990-08-07'),
        // Partecipazione
        createQuickNorm('Art. 7 L.241/90 - Comunicazione avvio', 'legge', '7', '241', '1990-08-07'),
        createQuickNorm('Art. 8 L.241/90 - Contenuto comunicazione', 'legge', '8', '241', '1990-08-07'),
        createQuickNorm('Art. 10 L.241/90 - Diritti partecipanti', 'legge', '10', '241', '1990-08-07'),
        createQuickNorm('Art. 10 bis L.241/90 - Preavviso rigetto', 'legge', '10 bis', '241', '1990-08-07'),
        // Conferenza servizi
        createQuickNorm('Art. 14 L.241/90 - Conferenza servizi', 'legge', '14', '241', '1990-08-07'),
        // Autotutela
        createQuickNorm('Art. 21 quinquies L.241/90 - Revoca', 'legge', '21 quinquies', '241', '1990-08-07'),
        createQuickNorm('Art. 21 nonies L.241/90 - Annullamento d\'ufficio', 'legge', '21 nonies', '241', '1990-08-07'),
        // SCIA e silenzio
        createQuickNorm('Art. 19 L.241/90 - SCIA', 'legge', '19', '241', '1990-08-07'),
        createQuickNorm('Art. 20 L.241/90 - Silenzio assenso', 'legge', '20', '241', '1990-08-07'),
        // Accesso
        createQuickNorm('Art. 22 L.241/90 - Accesso documenti', 'legge', '22', '241', '1990-08-07'),
    ],

    dossiers: [
        createDossier(
            'Principi del Procedimento',
            'Principi fondamentali dell\'azione amministrativa (artt. 1-3 L.241/90)',
            [
                createDossierItem('legge', '1', '241', '1990-08-07', 'important'),
                createDossierItem('legge', '2', '241', '1990-08-07', 'important'),
                createDossierItem('legge', '3', '241', '1990-08-07'),
                createDossierItem('legge', '3 bis', '241', '1990-08-07'),
            ],
            ['principi', 'motivazione', 'termini', 'trasparenza']
        ),
        createDossier(
            'Partecipazione al Procedimento',
            'Comunicazione avvio e diritti dei partecipanti (artt. 7-10 bis L.241/90)',
            [
                createDossierItem('legge', '7', '241', '1990-08-07', 'important'),
                createDossierItem('legge', '8', '241', '1990-08-07'),
                createDossierItem('legge', '9', '241', '1990-08-07'),
                createDossierItem('legge', '10', '241', '1990-08-07'),
                createDossierItem('legge', '10 bis', '241', '1990-08-07', 'important'),
            ],
            ['partecipazione', 'comunicazione', 'preavviso', 'contraddittorio']
        ),
        createDossier(
            'Autotutela Amministrativa',
            'Annullamento d\'ufficio e revoca (artt. 21 quinquies - 21 nonies L.241/90)',
            [
                createDossierItem('legge', '21 quinquies', '241', '1990-08-07', 'important'),
                createDossierItem('legge', '21 sexies', '241', '1990-08-07'),
                createDossierItem('legge', '21 septies', '241', '1990-08-07'),
                createDossierItem('legge', '21 octies', '241', '1990-08-07'),
                createDossierItem('legge', '21 nonies', '241', '1990-08-07', 'important'),
            ],
            ['autotutela', 'annullamento', 'revoca', '18 mesi']
        ),
        createDossier(
            'SCIA, Silenzio e Semplificazione',
            'Regimi di liberalizzazione e silenzio assenso (artt. 19-20 L.241/90)',
            [
                createDossierItem('legge', '19', '241', '1990-08-07', 'important'),
                createDossierItem('legge', '19 bis', '241', '1990-08-07'),
                createDossierItem('legge', '20', '241', '1990-08-07', 'important'),
            ],
            ['SCIA', 'silenzio assenso', 'semplificazione', 'liberalizzazione']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// CODICE DEI CONTRATTI PUBBLICI (D.LGS. 36/2023)
// ============================================
export const contrattiPubbliciEnvironment: Environment = {
    id: generateId(),
    name: 'Codice dei Contratti Pubblici',
    description: 'D.Lgs. 36/2023 - Nuovo Codice dei Contratti Pubblici: principi, programmazione, procedure di gara, esecuzione e contenzioso.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'administrative',
    color: '#0D9488', // Teal
    tags: ['appalti', 'contratti pubblici', 'gare', 'RUP', 'ANAC'],

    quickNorms: [
        // Principi
        createQuickNorm('Art. 1 D.Lgs.36/23 - Principio risultato', 'decreto legislativo', '1', '36', '2023-03-31'),
        createQuickNorm('Art. 2 D.Lgs.36/23 - Principio fiducia', 'decreto legislativo', '2', '36', '2023-03-31'),
        createQuickNorm('Art. 3 D.Lgs.36/23 - Principio accesso mercato', 'decreto legislativo', '3', '36', '2023-03-31'),
        // Soggetti
        createQuickNorm('Art. 15 D.Lgs.36/23 - RUP', 'decreto legislativo', '15', '36', '2023-03-31'),
        // Procedure sotto soglia
        createQuickNorm('Art. 50 D.Lgs.36/23 - Procedure sotto soglia', 'decreto legislativo', '50', '36', '2023-03-31'),
        // Procedure ordinarie
        createQuickNorm('Art. 70 D.Lgs.36/23 - Procedure aperte', 'decreto legislativo', '70', '36', '2023-03-31'),
        createQuickNorm('Art. 71 D.Lgs.36/23 - Procedure ristrette', 'decreto legislativo', '71', '36', '2023-03-31'),
        createQuickNorm('Art. 72 D.Lgs.36/23 - Procedura negoziata', 'decreto legislativo', '72', '36', '2023-03-31'),
        // Requisiti
        createQuickNorm('Art. 94 D.Lgs.36/23 - Cause esclusione automatica', 'decreto legislativo', '94', '36', '2023-03-31'),
        createQuickNorm('Art. 95 D.Lgs.36/23 - Cause esclusione non automatica', 'decreto legislativo', '95', '36', '2023-03-31'),
        // Offerta
        createQuickNorm('Art. 108 D.Lgs.36/23 - Criteri aggiudicazione', 'decreto legislativo', '108', '36', '2023-03-31'),
        createQuickNorm('Art. 110 D.Lgs.36/23 - Offerte anomale', 'decreto legislativo', '110', '36', '2023-03-31'),
        // Esecuzione
        createQuickNorm('Art. 117 D.Lgs.36/23 - Esecuzione contratto', 'decreto legislativo', '117', '36', '2023-03-31'),
        createQuickNorm('Art. 120 D.Lgs.36/23 - Modifiche contratto', 'decreto legislativo', '120', '36', '2023-03-31'),
    ],

    dossiers: [
        createDossier(
            'Principi Generali',
            'Principi fondamentali del nuovo Codice (artt. 1-12 D.Lgs. 36/2023)',
            [
                createDossierItem('decreto legislativo', '1', '36', '2023-03-31', 'important'),
                createDossierItem('decreto legislativo', '2', '36', '2023-03-31', 'important'),
                createDossierItem('decreto legislativo', '3', '36', '2023-03-31'),
                createDossierItem('decreto legislativo', '4', '36', '2023-03-31'),
                createDossierItem('decreto legislativo', '5', '36', '2023-03-31'),
            ],
            ['principi', 'risultato', 'fiducia', 'accesso mercato']
        ),
        createDossier(
            'Procedure di Gara Sotto Soglia',
            'Affidamenti sotto soglia e procedure semplificate (artt. 49-55 D.Lgs. 36/2023)',
            [
                createDossierItem('decreto legislativo', '49', '36', '2023-03-31'),
                createDossierItem('decreto legislativo', '50', '36', '2023-03-31', 'important'),
                createDossierItem('decreto legislativo', '51', '36', '2023-03-31'),
                createDossierItem('decreto legislativo', '52', '36', '2023-03-31'),
                createDossierItem('decreto legislativo', '54', '36', '2023-03-31'),
                createDossierItem('decreto legislativo', '55', '36', '2023-03-31'),
            ],
            ['sotto soglia', 'affidamento diretto', 'procedura negoziata']
        ),
        createDossier(
            'Requisiti e Cause di Esclusione',
            'Requisiti di partecipazione e cause di esclusione (artt. 94-98 D.Lgs. 36/2023)',
            [
                createDossierItem('decreto legislativo', '94', '36', '2023-03-31', 'important'),
                createDossierItem('decreto legislativo', '95', '36', '2023-03-31', 'important'),
                createDossierItem('decreto legislativo', '96', '36', '2023-03-31'),
                createDossierItem('decreto legislativo', '97', '36', '2023-03-31'),
                createDossierItem('decreto legislativo', '98', '36', '2023-03-31'),
            ],
            ['esclusione', 'requisiti', 'antimafia', 'irregolarità']
        ),
        createDossier(
            'Aggiudicazione e Offerte',
            'Criteri di aggiudicazione e verifica anomalia (artt. 108-115 D.Lgs. 36/2023)',
            [
                createDossierItem('decreto legislativo', '108', '36', '2023-03-31', 'important'),
                createDossierItem('decreto legislativo', '109', '36', '2023-03-31'),
                createDossierItem('decreto legislativo', '110', '36', '2023-03-31', 'important'),
                createDossierItem('decreto legislativo', '111', '36', '2023-03-31'),
            ],
            ['aggiudicazione', 'OEPV', 'prezzo più basso', 'anomalia']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// STATUTO DEI LAVORATORI (L. 300/1970)
// ============================================
export const statutoLavoratoriEnvironment: Environment = {
    id: generateId(),
    name: 'Statuto dei Lavoratori (L. 300/70)',
    description: 'Legge 300/1970 - Statuto dei Lavoratori: libertà e dignità del lavoratore, attività sindacale, tutela reale contro il licenziamento (art. 18).',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'civil',
    color: '#D97706', // Amber dark
    tags: ['lavoro', 'sindacati', 'licenziamento', 'art. 18', 'reintegrazione'],

    quickNorms: [
        // Libertà e dignità
        createQuickNorm('Art. 1 L.300/70 - Libertà opinione', 'legge', '1', '300', '1970-05-20'),
        createQuickNorm('Art. 2 L.300/70 - Guardie giurate', 'legge', '2', '300', '1970-05-20'),
        createQuickNorm('Art. 3 L.300/70 - Personale vigilanza', 'legge', '3', '300', '1970-05-20'),
        createQuickNorm('Art. 4 L.300/70 - Impianti audiovisivi', 'legge', '4', '300', '1970-05-20'),
        createQuickNorm('Art. 5 L.300/70 - Accertamenti sanitari', 'legge', '5', '300', '1970-05-20'),
        createQuickNorm('Art. 7 L.300/70 - Sanzioni disciplinari', 'legge', '7', '300', '1970-05-20'),
        createQuickNorm('Art. 8 L.300/70 - Divieto indagini', 'legge', '8', '300', '1970-05-20'),
        // Licenziamento
        createQuickNorm('Art. 18 L.300/70 - Tutela contro licenziamento', 'legge', '18', '300', '1970-05-20'),
        // Attività sindacale
        createQuickNorm('Art. 19 L.300/70 - RSA', 'legge', '19', '300', '1970-05-20'),
        createQuickNorm('Art. 20 L.300/70 - Assemblea', 'legge', '20', '300', '1970-05-20'),
        createQuickNorm('Art. 21 L.300/70 - Referendum', 'legge', '21', '300', '1970-05-20'),
        createQuickNorm('Art. 28 L.300/70 - Condotta antisindacale', 'legge', '28', '300', '1970-05-20'),
        // Campo applicazione
        createQuickNorm('Art. 35 L.300/70 - Campo applicazione', 'legge', '35', '300', '1970-05-20'),
    ],

    dossiers: [
        createDossier(
            'Libertà e Dignità del Lavoratore',
            'Titolo I: tutele fondamentali e controlli (artt. 1-13 L.300/70)',
            [
                createDossierItem('legge', '1', '300', '1970-05-20', 'important'),
                createDossierItem('legge', '2', '300', '1970-05-20'),
                createDossierItem('legge', '3', '300', '1970-05-20'),
                createDossierItem('legge', '4', '300', '1970-05-20', 'important'),
                createDossierItem('legge', '5', '300', '1970-05-20'),
                createDossierItem('legge', '6', '300', '1970-05-20'),
                createDossierItem('legge', '7', '300', '1970-05-20', 'important'),
                createDossierItem('legge', '8', '300', '1970-05-20'),
            ],
            ['libertà', 'dignità', 'controlli', 'disciplinare']
        ),
        createDossier(
            'Tutela Contro il Licenziamento',
            'Art. 18 e tutela reale/obbligatoria (artt. 18 L.300/70)',
            [
                createDossierItem('legge', '18', '300', '1970-05-20', 'important'),
            ],
            ['licenziamento', 'reintegrazione', 'tutela reale', 'art. 18']
        ),
        createDossier(
            'Attività Sindacale in Azienda',
            'Titolo III: rappresentanze e diritti sindacali (artt. 19-28 L.300/70)',
            [
                createDossierItem('legge', '19', '300', '1970-05-20', 'important'),
                createDossierItem('legge', '20', '300', '1970-05-20'),
                createDossierItem('legge', '21', '300', '1970-05-20'),
                createDossierItem('legge', '22', '300', '1970-05-20'),
                createDossierItem('legge', '23', '300', '1970-05-20'),
                createDossierItem('legge', '25', '300', '1970-05-20'),
                createDossierItem('legge', '26', '300', '1970-05-20'),
                createDossierItem('legge', '27', '300', '1970-05-20'),
                createDossierItem('legge', '28', '300', '1970-05-20', 'important'),
            ],
            ['sindacato', 'RSA', 'assemblea', 'antisindacale']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// JOBS ACT E TUTELE CRESCENTI (D.LGS. 23/2015)
// ============================================
export const jobsActEnvironment: Environment = {
    id: generateId(),
    name: 'Jobs Act - Tutele Crescenti',
    description: 'D.Lgs. 23/2015 sul contratto a tutele crescenti e D.Lgs. 81/2015 sui contratti flessibili. La nuova disciplina dei licenziamenti e dei rapporti di lavoro.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'civil',
    color: '#B45309', // Amber 700
    tags: ['Jobs Act', 'tutele crescenti', 'licenziamento', 'tempo determinato'],

    quickNorms: [
        // D.Lgs. 23/2015 - Tutele crescenti
        createQuickNorm('Art. 1 D.Lgs.23/15 - Campo applicazione', 'decreto legislativo', '1', '23', '2015-03-04'),
        createQuickNorm('Art. 2 D.Lgs.23/15 - Licenziamento discriminatorio', 'decreto legislativo', '2', '23', '2015-03-04'),
        createQuickNorm('Art. 3 D.Lgs.23/15 - Licenziamento per GMO/GC', 'decreto legislativo', '3', '23', '2015-03-04'),
        createQuickNorm('Art. 4 D.Lgs.23/15 - Vizi formali e procedurali', 'decreto legislativo', '4', '23', '2015-03-04'),
        createQuickNorm('Art. 6 D.Lgs.23/15 - Offerta conciliazione', 'decreto legislativo', '6', '23', '2015-03-04'),
        createQuickNorm('Art. 9 D.Lgs.23/15 - Piccole imprese', 'decreto legislativo', '9', '23', '2015-03-04'),
        // D.Lgs. 81/2015 - Contratti flessibili
        createQuickNorm('Art. 1 D.Lgs.81/15 - Lavoro subordinato', 'decreto legislativo', '1', '81', '2015-06-15'),
        createQuickNorm('Art. 2 D.Lgs.81/15 - Collaborazioni etero-organizzate', 'decreto legislativo', '2', '81', '2015-06-15'),
        createQuickNorm('Art. 19 D.Lgs.81/15 - Tempo determinato', 'decreto legislativo', '19', '81', '2015-06-15'),
        createQuickNorm('Art. 21 D.Lgs.81/15 - Proroghe e rinnovi', 'decreto legislativo', '21', '81', '2015-06-15'),
        createQuickNorm('Art. 33 D.Lgs.81/15 - Somministrazione', 'decreto legislativo', '33', '81', '2015-06-15'),
        createQuickNorm('Art. 54 D.Lgs.81/15 - Part-time', 'decreto legislativo', '54', '81', '2015-06-15'),
    ],

    dossiers: [
        createDossier(
            'Licenziamento e Tutele Crescenti',
            'Nuova disciplina dei licenziamenti (D.Lgs. 23/2015)',
            [
                createDossierItem('decreto legislativo', '1', '23', '2015-03-04', 'important'),
                createDossierItem('decreto legislativo', '2', '23', '2015-03-04', 'important'),
                createDossierItem('decreto legislativo', '3', '23', '2015-03-04', 'important'),
                createDossierItem('decreto legislativo', '4', '23', '2015-03-04'),
                createDossierItem('decreto legislativo', '5', '23', '2015-03-04'),
                createDossierItem('decreto legislativo', '6', '23', '2015-03-04'),
                createDossierItem('decreto legislativo', '9', '23', '2015-03-04'),
                createDossierItem('decreto legislativo', '10', '23', '2015-03-04'),
            ],
            ['licenziamento', 'tutele crescenti', 'indennità', 'reintegrazione']
        ),
        createDossier(
            'Contratto a Tempo Determinato',
            'Disciplina del tempo determinato (artt. 19-29 D.Lgs. 81/2015)',
            [
                createDossierItem('decreto legislativo', '19', '81', '2015-06-15', 'important'),
                createDossierItem('decreto legislativo', '20', '81', '2015-06-15'),
                createDossierItem('decreto legislativo', '21', '81', '2015-06-15', 'important'),
                createDossierItem('decreto legislativo', '22', '81', '2015-06-15'),
                createDossierItem('decreto legislativo', '23', '81', '2015-06-15'),
                createDossierItem('decreto legislativo', '24', '81', '2015-06-15'),
            ],
            ['tempo determinato', 'proroghe', 'rinnovi', '24 mesi']
        ),
        createDossier(
            'Collaborazioni e Lavoro Autonomo',
            'Collaborazioni coordinate e forme flessibili (artt. 2, 54-55 D.Lgs. 81/2015)',
            [
                createDossierItem('decreto legislativo', '1', '81', '2015-06-15'),
                createDossierItem('decreto legislativo', '2', '81', '2015-06-15', 'important'),
                createDossierItem('decreto legislativo', '54', '81', '2015-06-15'),
                createDossierItem('decreto legislativo', '55', '81', '2015-06-15'),
            ],
            ['collaborazioni', 'etero-organizzate', 'part-time', 'cococo']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// COSTITUZIONE ITALIANA
// ============================================
export const costituzioneEnvironment: Environment = {
    id: generateId(),
    name: 'Costituzione Italiana',
    description: 'La Costituzione della Repubblica Italiana: principi fondamentali, diritti e doveri dei cittadini, ordinamento della Repubblica.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'other',
    color: '#059669', // Emerald
    tags: ['costituzione', 'diritti fondamentali', 'libertà', 'ordinamento'],

    quickNorms: [
        // Principi fondamentali
        createQuickNorm('Art. 1 Cost. - Repubblica democratica', 'costituzione', '1'),
        createQuickNorm('Art. 2 Cost. - Diritti inviolabili', 'costituzione', '2'),
        createQuickNorm('Art. 3 Cost. - Uguaglianza', 'costituzione', '3'),
        createQuickNorm('Art. 4 Cost. - Diritto al lavoro', 'costituzione', '4'),
        createQuickNorm('Art. 10 Cost. - Diritto internazionale', 'costituzione', '10'),
        createQuickNorm('Art. 11 Cost. - Ripudio della guerra', 'costituzione', '11'),
        // Libertà civili
        createQuickNorm('Art. 13 Cost. - Libertà personale', 'costituzione', '13'),
        createQuickNorm('Art. 14 Cost. - Inviolabilità domicilio', 'costituzione', '14'),
        createQuickNorm('Art. 15 Cost. - Libertà comunicazioni', 'costituzione', '15'),
        createQuickNorm('Art. 21 Cost. - Libertà manifestazione pensiero', 'costituzione', '21'),
        createQuickNorm('Art. 24 Cost. - Diritto difesa', 'costituzione', '24'),
        createQuickNorm('Art. 25 Cost. - Giudice naturale', 'costituzione', '25'),
        // Rapporti economici
        createQuickNorm('Art. 36 Cost. - Retribuzione', 'costituzione', '36'),
        createQuickNorm('Art. 41 Cost. - Iniziativa economica', 'costituzione', '41'),
        createQuickNorm('Art. 42 Cost. - Proprietà', 'costituzione', '42'),
        createQuickNorm('Art. 53 Cost. - Capacità contributiva', 'costituzione', '53'),
    ],

    dossiers: [
        createDossier(
            'Principi Fondamentali',
            'I dodici articoli fondanti della Repubblica (artt. 1-12 Cost.)',
            [
                createDossierItem('costituzione', '1', undefined, undefined, 'important'),
                createDossierItem('costituzione', '2', undefined, undefined, 'important'),
                createDossierItem('costituzione', '3', undefined, undefined, 'important'),
                createDossierItem('costituzione', '4'),
                createDossierItem('costituzione', '5'),
                createDossierItem('costituzione', '6'),
                createDossierItem('costituzione', '7'),
                createDossierItem('costituzione', '8'),
                createDossierItem('costituzione', '9'),
                createDossierItem('costituzione', '10'),
                createDossierItem('costituzione', '11', undefined, undefined, 'important'),
                createDossierItem('costituzione', '12'),
            ],
            ['principi', 'democrazia', 'uguaglianza', 'lavoro']
        ),
        createDossier(
            'Diritti di Libertà',
            'Titolo I Parte I: libertà civili fondamentali (artt. 13-28 Cost.)',
            [
                createDossierItem('costituzione', '13', undefined, undefined, 'important'),
                createDossierItem('costituzione', '14'),
                createDossierItem('costituzione', '15'),
                createDossierItem('costituzione', '16'),
                createDossierItem('costituzione', '17'),
                createDossierItem('costituzione', '18'),
                createDossierItem('costituzione', '19'),
                createDossierItem('costituzione', '21', undefined, undefined, 'important'),
                createDossierItem('costituzione', '24', undefined, undefined, 'important'),
                createDossierItem('costituzione', '25'),
                createDossierItem('costituzione', '27'),
            ],
            ['libertà', 'diritti civili', 'difesa', 'habeas corpus']
        ),
        createDossier(
            'Rapporti Economici',
            'Titolo III Parte I: lavoro, economia, proprietà (artt. 35-47 Cost.)',
            [
                createDossierItem('costituzione', '35'),
                createDossierItem('costituzione', '36', undefined, undefined, 'important'),
                createDossierItem('costituzione', '37'),
                createDossierItem('costituzione', '38'),
                createDossierItem('costituzione', '39'),
                createDossierItem('costituzione', '40'),
                createDossierItem('costituzione', '41', undefined, undefined, 'important'),
                createDossierItem('costituzione', '42'),
                createDossierItem('costituzione', '43'),
            ],
            ['lavoro', 'economia', 'proprietà', 'impresa']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// DIRITTO SOCIETARIO
// ============================================
export const societarioEnvironment: Environment = {
    id: generateId(),
    name: 'Diritto Societario',
    description: 'Libro V del Codice Civile: disciplina delle società di persone, società di capitali (SpA, Srl), governance, responsabilità degli amministratori.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'civil',
    color: '#4F46E5', // Indigo
    tags: ['società', 'SpA', 'Srl', 'amministratori', 'governance'],

    quickNorms: [
        // Disposizioni generali
        createQuickNorm('Art. 2247 CC - Contratto di società', 'codice civile', '2247'),
        createQuickNorm('Art. 2249 CC - Tipi di società', 'codice civile', '2249'),
        // Società semplice
        createQuickNorm('Art. 2251 CC - Contratto sociale', 'codice civile', '2251'),
        createQuickNorm('Art. 2267 CC - Responsabilità soci', 'codice civile', '2267'),
        // SpA
        createQuickNorm('Art. 2325 CC - Responsabilità SpA', 'codice civile', '2325'),
        createQuickNorm('Art. 2328 CC - Atto costitutivo SpA', 'codice civile', '2328'),
        createQuickNorm('Art. 2346 CC - Emissione azioni', 'codice civile', '2346'),
        createQuickNorm('Art. 2380 bis CC - Gestione impresa', 'codice civile', '2380 bis'),
        createQuickNorm('Art. 2381 CC - CdA e deleghe', 'codice civile', '2381'),
        createQuickNorm('Art. 2392 CC - Responsabilità amministratori', 'codice civile', '2392'),
        createQuickNorm('Art. 2393 CC - Azione di responsabilità', 'codice civile', '2393'),
        createQuickNorm('Art. 2394 CC - Azione dei creditori', 'codice civile', '2394'),
        // Srl
        createQuickNorm('Art. 2462 CC - Responsabilità Srl', 'codice civile', '2462'),
        createQuickNorm('Art. 2463 CC - Atto costitutivo Srl', 'codice civile', '2463'),
        createQuickNorm('Art. 2475 CC - Amministrazione Srl', 'codice civile', '2475'),
        // Gruppi
        createQuickNorm('Art. 2497 CC - Direzione e coordinamento', 'codice civile', '2497'),
    ],

    dossiers: [
        createDossier(
            'Società di Capitali - SpA',
            'Disciplina della società per azioni (artt. 2325-2461 CC)',
            [
                createDossierItem('codice civile', '2325', undefined, undefined, 'important'),
                createDossierItem('codice civile', '2328'),
                createDossierItem('codice civile', '2346'),
                createDossierItem('codice civile', '2347'),
                createDossierItem('codice civile', '2357'),
                createDossierItem('codice civile', '2364'),
                createDossierItem('codice civile', '2377'),
                createDossierItem('codice civile', '2379'),
            ],
            ['SpA', 'azioni', 'assemblea', 'capitale']
        ),
        createDossier(
            'Governance e Amministratori SpA',
            'Sistema di amministrazione e controllo (artt. 2380-2409 CC)',
            [
                createDossierItem('codice civile', '2380 bis', undefined, undefined, 'important'),
                createDossierItem('codice civile', '2381', undefined, undefined, 'important'),
                createDossierItem('codice civile', '2383'),
                createDossierItem('codice civile', '2384'),
                createDossierItem('codice civile', '2388'),
                createDossierItem('codice civile', '2391'),
                createDossierItem('codice civile', '2392', undefined, undefined, 'important'),
                createDossierItem('codice civile', '2393'),
                createDossierItem('codice civile', '2394'),
                createDossierItem('codice civile', '2394 bis'),
            ],
            ['amministratori', 'responsabilità', 'deleghe', 'governance']
        ),
        createDossier(
            'Società a Responsabilità Limitata',
            'Disciplina della Srl (artt. 2462-2483 CC)',
            [
                createDossierItem('codice civile', '2462', undefined, undefined, 'important'),
                createDossierItem('codice civile', '2463'),
                createDossierItem('codice civile', '2468'),
                createDossierItem('codice civile', '2469'),
                createDossierItem('codice civile', '2473'),
                createDossierItem('codice civile', '2475', undefined, undefined, 'important'),
                createDossierItem('codice civile', '2476'),
                createDossierItem('codice civile', '2479'),
            ],
            ['Srl', 'quote', 'amministrazione', 'recesso']
        ),
        createDossier(
            'Gruppi Societari',
            'Direzione e coordinamento di società (artt. 2497-2497 septies CC)',
            [
                createDossierItem('codice civile', '2497', undefined, undefined, 'important'),
                createDossierItem('codice civile', '2497 bis'),
                createDossierItem('codice civile', '2497 ter'),
                createDossierItem('codice civile', '2497 quater'),
                createDossierItem('codice civile', '2497 sexies'),
            ],
            ['gruppi', 'holding', 'direzione', 'coordinamento']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// CODICE DI PROCEDURA CIVILE
// ============================================
export const cpcEnvironment: Environment = {
    id: generateId(),
    name: 'Codice di Procedura Civile',
    description: 'Il processo civile ordinario: principi, fase introduttiva, trattazione, istruttoria, decisione e impugnazioni.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'other',
    color: '#6366F1', // Indigo
    tags: ['processo civile', 'citazione', 'istruttoria', 'appello'],

    quickNorms: [
        // Principi
        createQuickNorm('Art. 99 CPC - Principio della domanda', 'codice di procedura civile', '99'),
        createQuickNorm('Art. 100 CPC - Interesse ad agire', 'codice di procedura civile', '100'),
        createQuickNorm('Art. 101 CPC - Principio del contraddittorio', 'codice di procedura civile', '101'),
        createQuickNorm('Art. 112 CPC - Corrispondenza domanda-pronuncia', 'codice di procedura civile', '112'),
        createQuickNorm('Art. 115 CPC - Disponibilità delle prove', 'codice di procedura civile', '115'),
        createQuickNorm('Art. 116 CPC - Valutazione delle prove', 'codice di procedura civile', '116'),
        // Atto di citazione
        createQuickNorm('Art. 163 CPC - Contenuto citazione', 'codice di procedura civile', '163'),
        createQuickNorm('Art. 167 CPC - Comparsa di risposta', 'codice di procedura civile', '167'),
        // Trattazione
        createQuickNorm('Art. 183 CPC - Prima udienza trattazione', 'codice di procedura civile', '183'),
        createQuickNorm('Art. 189 CPC - Precisazione conclusioni', 'codice di procedura civile', '189'),
        // Prove
        createQuickNorm('Art. 244 CPC - Prova per testimoni', 'codice di procedura civile', '244'),
        createQuickNorm('Art. 191 CPC - CTU', 'codice di procedura civile', '191'),
        // Decisione
        createQuickNorm('Art. 281 sexies CPC - Decisione a seguito trattazione orale', 'codice di procedura civile', '281 sexies'),
        createQuickNorm('Art. 282 CPC - Esecutorietà sentenza', 'codice di procedura civile', '282'),
        // Impugnazioni
        createQuickNorm('Art. 323 CPC - Mezzi di impugnazione', 'codice di procedura civile', '323'),
        createQuickNorm('Art. 339 CPC - Appello', 'codice di procedura civile', '339'),
    ],

    dossiers: [
        createDossier(
            'Principi del Processo Civile',
            'Disposizioni generali sul processo (artt. 99-111 CPC)',
            [
                createDossierItem('codice di procedura civile', '99', undefined, undefined, 'important'),
                createDossierItem('codice di procedura civile', '100'),
                createDossierItem('codice di procedura civile', '101', undefined, undefined, 'important'),
                createDossierItem('codice di procedura civile', '102'),
                createDossierItem('codice di procedura civile', '105'),
                createDossierItem('codice di procedura civile', '106'),
                createDossierItem('codice di procedura civile', '111'),
            ],
            ['principi', 'domanda', 'contraddittorio', 'legittimazione']
        ),
        createDossier(
            'Fase Introduttiva',
            'Citazione, comparsa e costituzione (artt. 163-171 CPC)',
            [
                createDossierItem('codice di procedura civile', '163', undefined, undefined, 'important'),
                createDossierItem('codice di procedura civile', '164'),
                createDossierItem('codice di procedura civile', '165'),
                createDossierItem('codice di procedura civile', '166'),
                createDossierItem('codice di procedura civile', '167', undefined, undefined, 'important'),
                createDossierItem('codice di procedura civile', '168 bis'),
                createDossierItem('codice di procedura civile', '171 bis'),
            ],
            ['citazione', 'comparsa', 'costituzione', 'nullità']
        ),
        createDossier(
            'Istruttoria e Decisione',
            'Trattazione della causa e fase decisoria (artt. 183-189, 281+ CPC)',
            [
                createDossierItem('codice di procedura civile', '183', undefined, undefined, 'important'),
                createDossierItem('codice di procedura civile', '184'),
                createDossierItem('codice di procedura civile', '185'),
                createDossierItem('codice di procedura civile', '187'),
                createDossierItem('codice di procedura civile', '189'),
                createDossierItem('codice di procedura civile', '281 sexies'),
                createDossierItem('codice di procedura civile', '282', undefined, undefined, 'important'),
            ],
            ['trattazione', 'istruttoria', 'decisione', 'sentenza']
        ),
        createDossier(
            'Impugnazioni',
            'Appello, ricorso per cassazione e altri mezzi (artt. 323-408 CPC)',
            [
                createDossierItem('codice di procedura civile', '323'),
                createDossierItem('codice di procedura civile', '324'),
                createDossierItem('codice di procedura civile', '325'),
                createDossierItem('codice di procedura civile', '327'),
                createDossierItem('codice di procedura civile', '339', undefined, undefined, 'important'),
                createDossierItem('codice di procedura civile', '342'),
                createDossierItem('codice di procedura civile', '360', undefined, undefined, 'important'),
            ],
            ['appello', 'cassazione', 'impugnazione', 'termini']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// CODICE DI PROCEDURA PENALE
// ============================================
export const cppEnvironment: Environment = {
    id: generateId(),
    name: 'Codice di Procedura Penale',
    description: 'Il processo penale italiano: indagini preliminari, udienza preliminare, dibattimento, sentenza e impugnazioni.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'other',
    color: '#DC2626', // Red
    tags: ['processo penale', 'indagini', 'dibattimento', 'sentenza'],

    quickNorms: [
        // Soggetti
        createQuickNorm('Art. 50 CPP - Azione penale', 'codice di procedura penale', '50'),
        createQuickNorm('Art. 60 CPP - Imputato', 'codice di procedura penale', '60'),
        createQuickNorm('Art. 61 CPP - Estensione diritti imputato', 'codice di procedura penale', '61'),
        // Indagini preliminari
        createQuickNorm('Art. 326 CPP - Finalità indagini', 'codice di procedura penale', '326'),
        createQuickNorm('Art. 329 CPP - Obbligo segreto', 'codice di procedura penale', '329'),
        createQuickNorm('Art. 347 CPP - Obbligo riferire notizia reato', 'codice di procedura penale', '347'),
        createQuickNorm('Art. 358 CPP - Attività del PM', 'codice di procedura penale', '358'),
        createQuickNorm('Art. 369 CPP - Informazione garanzia', 'codice di procedura penale', '369'),
        // Azione penale
        createQuickNorm('Art. 405 CPP - Inizio azione penale', 'codice di procedura penale', '405'),
        createQuickNorm('Art. 408 CPP - Richiesta archiviazione', 'codice di procedura penale', '408'),
        // Udienza preliminare
        createQuickNorm('Art. 416 CPP - Richiesta rinvio a giudizio', 'codice di procedura penale', '416'),
        createQuickNorm('Art. 421 CPP - Udienza preliminare', 'codice di procedura penale', '421'),
        createQuickNorm('Art. 425 CPP - Sentenza non luogo a procedere', 'codice di procedura penale', '425'),
        createQuickNorm('Art. 429 CPP - Decreto rinvio a giudizio', 'codice di procedura penale', '429'),
        // Dibattimento
        createQuickNorm('Art. 496 CPP - Ordine esame parti', 'codice di procedura penale', '496'),
        createQuickNorm('Art. 530 CPP - Sentenza assolutoria', 'codice di procedura penale', '530'),
        createQuickNorm('Art. 533 CPP - Sentenza di condanna', 'codice di procedura penale', '533'),
    ],

    dossiers: [
        createDossier(
            'Indagini Preliminari',
            'Fase delle indagini e attività di PM e PG (artt. 326-378 CPP)',
            [
                createDossierItem('codice di procedura penale', '326', undefined, undefined, 'important'),
                createDossierItem('codice di procedura penale', '327'),
                createDossierItem('codice di procedura penale', '329'),
                createDossierItem('codice di procedura penale', '330'),
                createDossierItem('codice di procedura penale', '347'),
                createDossierItem('codice di procedura penale', '358'),
                createDossierItem('codice di procedura penale', '369', undefined, undefined, 'important'),
                createDossierItem('codice di procedura penale', '375'),
            ],
            ['indagini', 'PM', 'PG', 'informazione garanzia']
        ),
        createDossier(
            'Esercizio Azione Penale',
            'Archiviazione o rinvio a giudizio (artt. 405-415 CPP)',
            [
                createDossierItem('codice di procedura penale', '405', undefined, undefined, 'important'),
                createDossierItem('codice di procedura penale', '406'),
                createDossierItem('codice di procedura penale', '407'),
                createDossierItem('codice di procedura penale', '408', undefined, undefined, 'important'),
                createDossierItem('codice di procedura penale', '409'),
                createDossierItem('codice di procedura penale', '411'),
            ],
            ['azione penale', 'archiviazione', 'imputazione', 'termini']
        ),
        createDossier(
            'Udienza Preliminare',
            'Vaglio dell\'accusa e decisione sul rinvio (artt. 416-433 CPP)',
            [
                createDossierItem('codice di procedura penale', '416', undefined, undefined, 'important'),
                createDossierItem('codice di procedura penale', '418'),
                createDossierItem('codice di procedura penale', '421'),
                createDossierItem('codice di procedura penale', '422'),
                createDossierItem('codice di procedura penale', '425', undefined, undefined, 'important'),
                createDossierItem('codice di procedura penale', '429'),
            ],
            ['udienza preliminare', 'GUP', 'rinvio a giudizio', 'non luogo']
        ),
        createDossier(
            'Dibattimento e Sentenza',
            'Fase dibattimentale e decisione (artt. 470-548 CPP)',
            [
                createDossierItem('codice di procedura penale', '470'),
                createDossierItem('codice di procedura penale', '484'),
                createDossierItem('codice di procedura penale', '496'),
                createDossierItem('codice di procedura penale', '498'),
                createDossierItem('codice di procedura penale', '523'),
                createDossierItem('codice di procedura penale', '530', undefined, undefined, 'important'),
                createDossierItem('codice di procedura penale', '533', undefined, undefined, 'important'),
            ],
            ['dibattimento', 'sentenza', 'assoluzione', 'condanna']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// DIRITTO TRIBUTARIO
// ============================================
export const tributarioEnvironment: Environment = {
    id: generateId(),
    name: 'Diritto Tributario',
    description: 'Statuto del contribuente (L. 212/2000), accertamento (D.P.R. 600/1973), riscossione e sanzioni tributarie.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'administrative',
    color: '#16A34A', // Green
    tags: ['tributi', 'fisco', 'accertamento', 'sanzioni', 'contribuente'],

    quickNorms: [
        // Statuto contribuente
        createQuickNorm('Art. 1 L.212/00 - Principi generali', 'legge', '1', '212', '2000-07-27'),
        createQuickNorm('Art. 3 L.212/00 - Efficacia temporale', 'legge', '3', '212', '2000-07-27'),
        createQuickNorm('Art. 6 L.212/00 - Conoscenza atti', 'legge', '6', '212', '2000-07-27'),
        createQuickNorm('Art. 7 L.212/00 - Chiarezza e motivazione', 'legge', '7', '212', '2000-07-27'),
        createQuickNorm('Art. 10 L.212/00 - Tutela affidamento', 'legge', '10', '212', '2000-07-27'),
        createQuickNorm('Art. 11 L.212/00 - Interpello', 'legge', '11', '212', '2000-07-27'),
        createQuickNorm('Art. 12 L.212/00 - Diritti contribuente verifiche', 'legge', '12', '212', '2000-07-27'),
        // DPR 600/1973 Accertamento
        createQuickNorm('Art. 32 DPR 600/73 - Poteri uffici', 'decreto del presidente della repubblica', '32', '600', '1973-09-29'),
        createQuickNorm('Art. 38 DPR 600/73 - Accertamento sintetico', 'decreto del presidente della repubblica', '38', '600', '1973-09-29'),
        createQuickNorm('Art. 39 DPR 600/73 - Accertamento analitico', 'decreto del presidente della repubblica', '39', '600', '1973-09-29'),
        createQuickNorm('Art. 41 DPR 600/73 - Accertamento d\'ufficio', 'decreto del presidente della repubblica', '41', '600', '1973-09-29'),
        createQuickNorm('Art. 42 DPR 600/73 - Avviso accertamento', 'decreto del presidente della repubblica', '42', '600', '1973-09-29'),
        createQuickNorm('Art. 43 DPR 600/73 - Termini accertamento', 'decreto del presidente della repubblica', '43', '600', '1973-09-29'),
    ],

    dossiers: [
        createDossier(
            'Statuto del Contribuente',
            'Diritti e garanzie del contribuente (L. 212/2000)',
            [
                createDossierItem('legge', '1', '212', '2000-07-27', 'important'),
                createDossierItem('legge', '2', '212', '2000-07-27'),
                createDossierItem('legge', '3', '212', '2000-07-27'),
                createDossierItem('legge', '5', '212', '2000-07-27'),
                createDossierItem('legge', '6', '212', '2000-07-27'),
                createDossierItem('legge', '7', '212', '2000-07-27', 'important'),
                createDossierItem('legge', '10', '212', '2000-07-27', 'important'),
                createDossierItem('legge', '11', '212', '2000-07-27'),
                createDossierItem('legge', '12', '212', '2000-07-27'),
            ],
            ['statuto', 'contribuente', 'diritti', 'affidamento']
        ),
        createDossier(
            'Accertamento Tributario',
            'Modalità di accertamento delle imposte (D.P.R. 600/1973)',
            [
                createDossierItem('decreto del presidente della repubblica', '31', '600', '1973-09-29'),
                createDossierItem('decreto del presidente della repubblica', '32', '600', '1973-09-29', 'important'),
                createDossierItem('decreto del presidente della repubblica', '33', '600', '1973-09-29'),
                createDossierItem('decreto del presidente della repubblica', '38', '600', '1973-09-29', 'important'),
                createDossierItem('decreto del presidente della repubblica', '39', '600', '1973-09-29', 'important'),
                createDossierItem('decreto del presidente della repubblica', '41', '600', '1973-09-29'),
                createDossierItem('decreto del presidente della repubblica', '42', '600', '1973-09-29'),
                createDossierItem('decreto del presidente della repubblica', '43', '600', '1973-09-29', 'important'),
            ],
            ['accertamento', 'sintetico', 'analitico', 'termini']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// ============================================
// TRATTATI UE - PRINCIPI FONDAMENTALI
// ============================================
export const trattatiUEEnvironment: Environment = {
    id: generateId(),
    name: 'Trattati UE - Principi Fondamentali',
    description: 'I trattati fondamentali dell\'Unione Europea: TUE (Trattato sull\'UE), TFUE (Trattato sul Funzionamento UE) e Carta dei Diritti Fondamentali.',
    author: 'VisuaLex Team',
    version: '1.0',
    createdAt: new Date().toISOString(),
    category: 'eu',
    color: '#1D4ED8', // Blue
    tags: ['UE', 'trattati', 'TUE', 'TFUE', 'diritti fondamentali'],

    quickNorms: [
        // TUE
        createQuickNorm('Art. 1 TUE - Istituzione Unione', 'tue', '1'),
        createQuickNorm('Art. 2 TUE - Valori dell\'Unione', 'tue', '2'),
        createQuickNorm('Art. 3 TUE - Obiettivi dell\'Unione', 'tue', '3'),
        createQuickNorm('Art. 4 TUE - Competenze dell\'Unione', 'tue', '4'),
        createQuickNorm('Art. 5 TUE - Principi attribuzione e sussidiarietà', 'tue', '5'),
        createQuickNorm('Art. 6 TUE - Diritti fondamentali', 'tue', '6'),
        // TFUE
        createQuickNorm('Art. 18 TFUE - Non discriminazione', 'tfue', '18'),
        createQuickNorm('Art. 20 TFUE - Cittadinanza UE', 'tfue', '20'),
        createQuickNorm('Art. 21 TFUE - Libera circolazione cittadini', 'tfue', '21'),
        createQuickNorm('Art. 34 TFUE - Libera circolazione merci', 'tfue', '34'),
        createQuickNorm('Art. 45 TFUE - Libera circolazione lavoratori', 'tfue', '45'),
        createQuickNorm('Art. 49 TFUE - Libertà stabilimento', 'tfue', '49'),
        createQuickNorm('Art. 56 TFUE - Libera prestazione servizi', 'tfue', '56'),
        createQuickNorm('Art. 101 TFUE - Intese vietate', 'tfue', '101'),
        createQuickNorm('Art. 102 TFUE - Abuso posizione dominante', 'tfue', '102'),
        // Carta diritti
        createQuickNorm('Art. 1 CDFUE - Dignità umana', 'cdfue', '1'),
        createQuickNorm('Art. 7 CDFUE - Vita privata e familiare', 'cdfue', '7'),
        createQuickNorm('Art. 8 CDFUE - Protezione dati personali', 'cdfue', '8'),
        createQuickNorm('Art. 47 CDFUE - Diritto ricorso effettivo', 'cdfue', '47'),
    ],

    dossiers: [
        createDossier(
            'Principi Fondamentali TUE',
            'Valori, obiettivi e competenze dell\'Unione (artt. 1-12 TUE)',
            [
                createDossierItem('tue', '1'),
                createDossierItem('tue', '2', undefined, undefined, 'important'),
                createDossierItem('tue', '3', undefined, undefined, 'important'),
                createDossierItem('tue', '4'),
                createDossierItem('tue', '5', undefined, undefined, 'important'),
                createDossierItem('tue', '6'),
            ],
            ['TUE', 'valori', 'competenze', 'sussidiarietà']
        ),
        createDossier(
            'Libertà Fondamentali TFUE',
            'Le quattro libertà del mercato interno',
            [
                createDossierItem('tfue', '18'),
                createDossierItem('tfue', '20'),
                createDossierItem('tfue', '21'),
                createDossierItem('tfue', '34', undefined, undefined, 'important'),
                createDossierItem('tfue', '45', undefined, undefined, 'important'),
                createDossierItem('tfue', '49'),
                createDossierItem('tfue', '56', undefined, undefined, 'important'),
            ],
            ['libertà', 'mercato interno', 'circolazione', 'stabilimento']
        ),
        createDossier(
            'Concorrenza UE',
            'Regole di concorrenza del TFUE (artt. 101-109)',
            [
                createDossierItem('tfue', '101', undefined, undefined, 'important'),
                createDossierItem('tfue', '102', undefined, undefined, 'important'),
                createDossierItem('tfue', '106'),
                createDossierItem('tfue', '107'),
                createDossierItem('tfue', '108'),
            ],
            ['concorrenza', 'antitrust', 'intese', 'aiuti di Stato']
        ),
        createDossier(
            'Carta dei Diritti Fondamentali',
            'Diritti fondamentali nell\'UE (CDFUE)',
            [
                createDossierItem('cdfue', '1', undefined, undefined, 'important'),
                createDossierItem('cdfue', '6'),
                createDossierItem('cdfue', '7'),
                createDossierItem('cdfue', '8', undefined, undefined, 'important'),
                createDossierItem('cdfue', '16'),
                createDossierItem('cdfue', '17'),
                createDossierItem('cdfue', '47', undefined, undefined, 'important'),
                createDossierItem('cdfue', '52'),
            ],
            ['diritti fondamentali', 'Carta', 'dignità', 'dati personali']
        ),
    ],

    annotations: [],
    highlights: [],
    customAliases: [],
};

// Export all example environments
export const exampleEnvironments: Environment[] = [
    // Compliance & EU
    gdprEnvironment,
    doraEnvironment,
    aiActEnvironment,
    trattatiUEEnvironment,
    // Civil
    consumerLawEnvironment,
    codiceCivileObbligazioniEnvironment,
    codiceCivileResponsabilitaEnvironment,
    codiceCivileProprietaEnvironment,
    codiceCivileFamigliaEnvironment,
    societarioEnvironment,
    statutoLavoratoriEnvironment,
    jobsActEnvironment,
    // Penal
    codicePenaleGeneraleEnvironment,
    codicePenaleReatiEnvironment,
    // Administrative
    legge241Environment,
    contrattiPubbliciEnvironment,
    tributarioEnvironment,
    // Procedural & Constitutional
    costituzioneEnvironment,
    cpcEnvironment,
    cppEnvironment,
];

export default exampleEnvironments;
