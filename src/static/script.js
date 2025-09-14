document.addEventListener('DOMContentLoaded', () => {
    // ============================
    // Configurazione e Costanti
    // ============================
    const DEBUG = true; // Imposta su false per disabilitare i log di debug

    const logger = {
        log: (...args) => DEBUG && console.log(...args),
        error: (...args) => console.error(...args),
        warn: (...args) => DEBUG && console.warn(...args),
    };

    const ACT_TYPES_REQUIRING_DETAILS = [
        'legge',
        'decreto legge',
        'decreto legislativo',
        'Regolamento UE',
        'Direttiva UE',
    ];

    const SELECTORS = {
        scrapeForm: '#scrape-form',
        normeContainer: '#norme-container',
        loadingIndicator: '#loading',
        errorContainer: '#error-container',
        historyList: '#history-list',
        resetHistoryButton: '#reset-history',
        resetButton: '#reset-button',
        clearSearchFieldsButton: '#clear-search-fields',
        historySearchInput: '#history-search',
        actTypeSelect: '#act_type',
        actNumberInput: '#act_number',
        dateInput: '#date',
        versionRadios: 'input[name="version"]',
        versionDateInput: '#version_date',
        articleInput: '#article',
        incrementButton: '.increment',
        decrementButton: '.decrement',
    };

    // ============================
    // Riferimenti agli Elementi del DOM
    // ============================
    const elements = Object.fromEntries(
        Object.entries(SELECTORS).map(([key, selector]) => [
            key,
            key === 'versionRadios' ? document.querySelectorAll(selector) : document.querySelector(selector),
        ])
    );

    // ============================
    // Verifica degli Elementi
    // ============================
    Object.entries(elements).forEach(([key, element]) => {
        if (!element && key !== 'versionRadios') {
            logger.error(`Elemento '${key}' non trovato nel DOM.`);
        } else {
            logger.log(`${key}:`, element);
        }
    });

    // ============================
    // Variabili e Stato
    // ============================
    let pinnedTabs = {};
    let normaContainers = {};

    // ============================
    // Funzioni di Utilità
    // ============================
    const showError = (message) => {
        if (elements.errorContainer) {
            elements.errorContainer.textContent = message;
            elements.errorContainer.style.display = 'block';
            logger.error('Errore:', message);
        } else {
            logger.error("Elemento 'error-container' non trovato nel DOM.");
        }
    };

    const hideError = () => {
        if (elements.errorContainer) {
            elements.errorContainer.textContent = '';
            elements.errorContainer.style.display = 'none';
        }
    };

    const debounce = (func, delay) => {
        let debounceTimer;
        return (...args) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => func.apply(this, args), delay);
        };
    };

    const sanitize = (str) => str.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();

    const capitalizeFirstLetter = (string) => string.charAt(0).toUpperCase() + string.slice(1);

    /**
     * Genera una chiave unica per una norma includendo solo i campi presenti.
     * @param {Object} normaData - Dati della norma.
     * @returns {string} - NormaKey generata.
     */
    const generateNormaKey = (normaData) => {
        const parts = [normaData.tipo_atto];

        if (normaData.numero_atto && normaData.numero_atto.trim() !== '') {
            parts.push(normaData.numero_atto);
        }

        if (normaData.data && normaData.data.trim() !== '') {
            parts.push(normaData.data);
        }

        return parts.map(part => sanitize(part)).join('--');
    };

    const viewPDF = async (urn) => {
        try {
            // Mostra la barra di progresso (progressContainer e progressBar devono essere visibili)
            const progressContainer = document.getElementById('pdfProgressContainer');
            const progressBar = document.getElementById('pdfProgressBar');
            progressContainer.style.display = 'block';
            // Imposta la barra a 0 e, se non è possibile calcolare la percentuale, rendila indeterminata
            progressBar.value = 0;
            progressBar.setAttribute('max', '100');
            
            const response = await fetch('/export_pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urn })
            });
            if (!response.ok) {
                throw new Error('Errore durante l\'esportazione del PDF.');
            }
            const contentType = response.headers.get('Content-Type');
            if (!contentType || !contentType.includes('application/pdf')) {
                const errorText = await response.text();
                throw new Error(`La risposta non è un PDF valido: ${errorText}`);
            }
            
            // Ottieni il Content-Length se disponibile
            const contentLengthHeader = response.headers.get('Content-Length');
            const total = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
            if (!total) {
                // Se non c'è Content-Length, mostra la barra in modalità indeterminata
                progressBar.removeAttribute('value');
            }
            
            // Leggi lo stream della response
            const reader = response.body.getReader();
            let receivedLength = 0;
            const chunks = [];
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                receivedLength += value.length;
                // Se conosciamo il totale, aggiorna la barra
                if (total) {
                    progressBar.value = Math.round((receivedLength / total) * 100);
                }
            }
            
            // Nascondi la barra di progresso ora che il download è completato
            progressContainer.style.display = 'none';
            
            // Combina i chunk in un unico array di bytes
            let chunksAll = new Uint8Array(receivedLength);
            let position = 0;
            for (let chunk of chunks) {
                chunksAll.set(chunk, position);
                position += chunk.length;
            }
            const blob = new Blob([chunksAll], { type: 'application/pdf' });
            if (blob.size === 0) {
                throw new Error("Il PDF è vuoto.");
            }
            const url = window.URL.createObjectURL(blob);
            
            // Estrai il filename dal Content-Disposition, se presente
            const contentDisposition = response.headers.get('Content-Disposition');
            let defaultFilename = `Norma_${urn}.pdf`;
            if (contentDisposition) {
                const match = contentDisposition.match(/filename="?([^"]+)"?/);
                if (match && match[1]) {
                    defaultFilename = match[1];
                }
            }
            
            // Imposta l'URL nell'iframe per visualizzare il PDF
            const pdfIframe = document.getElementById('pdfIframe');
            pdfIframe.src = url;
            
            // Imposta il link per il download con il filename corretto
            const downloadBtn = document.getElementById('downloadPdfBtn');
            downloadBtn.href = url;
            downloadBtn.download = defaultFilename;
            downloadBtn.textContent = `Download ${defaultFilename}`;
            
            // Mostra il modal con il PDF usando Bootstrap
            const modalElement = document.getElementById('pdfModal');
            const pdfModal = new bootstrap.Modal(modalElement);
            pdfModal.show();
            
            // Quando il modal viene chiuso, revoca l'object URL per liberare memoria
            modalElement.addEventListener('hidden.bs.modal', () => {
                window.URL.revokeObjectURL(url);
                logger.log("Object URL revocato dopo la chiusura del modal");
            }, { once: true });
            
            logger.log('PDF visualizzato per urn:', urn);
        } catch (error) {
            // Assicurati di nascondere sempre la barra di caricamento in caso di errore
            const progressContainer = document.getElementById('pdfProgressContainer');
            if (progressContainer) progressContainer.style.display = 'none';
            showError(error.message || 'Errore durante la visualizzazione del PDF.');
            logger.error('Errore visualizzazione PDF:', error);
        }
    };
    
    /**
 * Aggiunge un singolo risultato (risultato streaming) all'interfaccia.
 * Raggruppa per norma e crea (se necessario) il contenitore e il tab.
 * @param {Object} result - Il risultato (un singolo oggetto JSON).
 */
const appendResult = (result) => {
    if (!elements.normeContainer) {
        logger.error("Elemento 'norme-container' non trovato nel DOM.");
        return;
    }
    const normaData = result.norma_data;
    if (!normaData) {
        logger.warn('Dati della norma mancanti nel risultato:', result);
        return;
    }
    // Genera una chiave unica per la norma (senza numero_articolo)
    const normaKey = generateNormaKey(normaData);
    let normElements = normaContainers[normaKey];
    if (!normElements) {
        normElements = createNormContainer(normaData);
        normaContainers[normaKey] = normElements;
    }
    createArticleTab(result, normElements);
    logger.log('Risultato aggiunto:', result);
};


    /**
     * Genera una chiave unica per un articolo includendo i campi della norma più numero_articolo.
     * @param {Object} normaData - Dati della norma.
     * @returns {string} - ArticleKey generata.
     */
    const generateArticleKey = (normaData) => {
        const parts = [normaData.tipo_atto];

        if (normaData.numero_atto && normaData.numero_atto.trim() !== '') {
            parts.push(normaData.numero_atto);
        }

        if (normaData.data && normaData.data.trim() !== '') {
            parts.push(normaData.data);
        }

        if (normaData.numero_articolo && normaData.numero_articolo.trim() !== '') {
            parts.push(normaData.numero_articolo);
        }

        return parts.map(part => sanitize(part)).join('--');
    };

    const savePinnedTabs = () => {
        try {
            localStorage.setItem('pinnedTabs', JSON.stringify(pinnedTabs));
            logger.log('Pinned tabs salvati:', pinnedTabs);
        } catch (error) {
            logger.error('Impossibile salvare i tab pinnati:', error);
        }
    };

    const loadPinnedTabs = () => {
        if (!localStorage || !elements.normeContainer) return;

        try {
            const savedPinnedTabs = localStorage.getItem('pinnedTabs');
            if (savedPinnedTabs) {
                pinnedTabs = JSON.parse(savedPinnedTabs);
                logger.log('Tab pinnati trovati:', pinnedTabs);

                // Raggruppa i tab pinnati per norma (senza numero_articolo)
                const normaDict = {};

                Object.values(pinnedTabs).forEach((articleData) => {
                    const { norma_data: normaData } = articleData;
                    if (!normaData) {
                        logger.warn('Dati della norma mancanti nell\'articolo pinnato:', articleData);
                        return;
                    }
                    // Genera una chiave consistente senza numero_articolo
                    const normaKey = generateNormaKey(normaData);

                    normaDict[normaKey] = normaDict[normaKey] || {
                        norma_data: normaData,
                        articles: [],
                    };

                    normaDict[normaKey].articles.push(articleData);
                });

                // Crea i contenitori delle norme e aggiungi i tab pinnati
                Object.entries(normaDict).forEach(([normaKey, norma]) => {
                    let normElements = normaContainers[normaKey];

                    if (!normElements) {
                        normElements = createNormContainer(norma.norma_data);
                        normaContainers[normaKey] = normElements;
                    }

                    norma.articles.forEach((articleData) => {
                        createArticleTab(articleData, normElements, true);
                    });
                });

                logger.log('Tab pinnati caricati.');
            } else {
                logger.log('Nessun tab pinnato salvato.');
            }
        } catch (error) {
            logger.error('Errore nel caricamento dei tab pinnati:', error);
        }
    };

    const saveToHistory = (data) => {
        if (!elements.historyList) return;
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item';
        listItem.textContent = `${capitalizeFirstLetter(data.act_type || 'N/A')} ${data.act_number || 'N/A'}, Articolo ${data.article || 'N/A'}`;
        elements.historyList.appendChild(listItem);
        logger.log('Ricerca salvata nella cronologia:', listItem.textContent);
    };

    const populateBrocardiInfo = (brocardiInfo, brocardiInfoDiv) => {
        if (!brocardiInfoDiv) return;
        const brocardiContentDiv = brocardiInfoDiv.querySelector('.brocardi-content');
        if (!brocardiContentDiv) return;

        brocardiContentDiv.innerHTML = ''; // Resetta il contenuto

        const createSection = (title, content, isList = false) => {
            if (!content || (Array.isArray(content) && content.length === 0)) return;

            const sectionDiv = document.createElement('div');
            sectionDiv.classList.add('brocardi-section');

            const heading = document.createElement('h6');
            heading.textContent = `${title}:`;
            sectionDiv.appendChild(heading);

            if (isList && Array.isArray(content)) {
                const listContainer = document.createElement('div');
                listContainer.classList.add(`${title.toLowerCase()}-list`);

                content.forEach((item) => {
                    const trimmedItem = item.trim();
                    if (trimmedItem !== '') {
                        const itemBox = document.createElement('div');
                        itemBox.classList.add('brocardi-item', 'resizable');
                        itemBox.innerHTML = trimmedItem;
                        listContainer.appendChild(itemBox);
                    }
                });

                if (listContainer.children.length > 0) {
                    sectionDiv.appendChild(listContainer);
                    brocardiContentDiv.appendChild(sectionDiv);
                }
            } else if (typeof content === 'string') {
                const trimmedContent = content.trim();
                if (trimmedContent !== '') {
                    const paragraph = document.createElement('p');
                    paragraph.innerHTML = trimmedContent;
                    sectionDiv.appendChild(paragraph);
                    brocardiContentDiv.appendChild(sectionDiv);
                }
            }
        };

        // Aggiungi le sezioni esistenti
        createSection('Brocardi', brocardiInfo.Brocardi, true);
        createSection('Ratio', brocardiInfo.Ratio);
        createSection('Spiegazione', brocardiInfo.Spiegazione);
        createSection('Massime', brocardiInfo.Massime, true);

        // Aggiungi il link se presente
        if (brocardiInfo.link) {
            const linkDiv = document.createElement('div');
            linkDiv.classList.add('brocardi-section');
            const heading = document.createElement('h6');
            heading.textContent = 'Link:';
            linkDiv.appendChild(heading);
            const link = document.createElement('a');
            link.href = brocardiInfo.link;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = brocardiInfo.link;
            linkDiv.appendChild(link);
            brocardiContentDiv.appendChild(linkDiv);
        }

        // Aggiungi la posizione se presente
        if (brocardiInfo.position) {
            const positionDiv = document.createElement('div');
            positionDiv.classList.add('brocardi-section');
            const heading = document.createElement('h6');
            heading.textContent = 'Posizione:';
            positionDiv.appendChild(heading);
            const positionParagraph = document.createElement('p');
            positionParagraph.textContent = brocardiInfo.position;
            positionDiv.appendChild(positionParagraph);
            brocardiContentDiv.appendChild(positionDiv);
        }

        // Nascondi le massime in posizione dispari
        const massimeSection = brocardiContentDiv.querySelector('.massime-list');
        if (massimeSection) {
            const massimeItems = massimeSection.querySelectorAll('.brocardi-item');
            massimeItems.forEach((item, index) => {
                if ((index + 1) % 2 !== 0) {
                    item.style.display = 'none';
                }
            });
        }

        logger.log('Informazioni Brocardi popolate.');
    };

    // ============================
    // Funzioni Principali
    // ============================

    const toggleActDetails = () => {
        if (!elements.actTypeSelect || !elements.actNumberInput || !elements.dateInput) return;
        const selectedActType = elements.actTypeSelect.value;

        const requiresDetails = ACT_TYPES_REQUIRING_DETAILS.includes(selectedActType);

        elements.actNumberInput.disabled = !requiresDetails;
        elements.actNumberInput.required = requiresDetails;
        elements.dateInput.disabled = !requiresDetails;
        elements.dateInput.required = requiresDetails;

        elements.actNumberInput.classList.toggle('disabled', !requiresDetails);
        elements.dateInput.classList.toggle('disabled', !requiresDetails);

        if (!requiresDetails) {
            elements.actNumberInput.value = '';
            elements.dateInput.value = '';
        }

        logger.log(`Campi 'Numero Atto' e 'Data' ${requiresDetails ? 'abilitati' : 'disabilitati'} per tipo atto: ${selectedActType}`);
    };

    const toggleVersionDate = () => {
        if (!elements.versionRadios || !elements.versionDateInput) return;
        const selectedVersion = document.querySelector('input[name="version"]:checked')?.value;

        const disableVersionDate = selectedVersion === 'originale';
        elements.versionDateInput.disabled = disableVersionDate;
        elements.versionDateInput.classList.toggle('disabled', disableVersionDate);

        if (disableVersionDate) {
            elements.versionDateInput.value = '';
        }

        logger.log(`Campo 'Data versione' ${disableVersionDate ? 'disabilitato' : 'abilitato'}.`);
    };

    // ==== NUOVE FUNZIONI ==== //
    /**
     * Gestisce il pin/unpin di un articolo.
     * @param {string} key - La chiave dell'articolo.
     * @param {Object} articleData - I dati dell'articolo.
     */
    const togglePin = (key, articleData) => {
        if (pinnedTabs[key]) {
            delete pinnedTabs[key];
            updatePinIcon(false, key); // Aggiorna l'icona come non pinnata
            logger.log(`Tab ${key} unpinned.`);
        } else {
            pinnedTabs[key] = articleData;
            updatePinIcon(true, key); // Aggiorna l'icona come pinnata
            logger.log(`Tab ${key} pinned.`);
        }
        savePinnedTabs(); // Salva lo stato aggiornato
    };

    /**
     * Aggiorna l'icona del pin e la classe 'pinned' sull'elemento .nav-link.
     * @param {boolean} isPinned - Se true, imposta l'icona come pinnata.
     * @param {string} key - La chiave dell'articolo.
     */
    const updatePinIcon = (isPinned, key) => {
        const pinButton = document.querySelector(`.pin-button[data-key="${key}"]`);
        if (!pinButton) {
            logger.error(`Pin button non trovato per la chiave: ${key}`);
            return;
        }

        // Log per verificare il pinButton
        logger.log(`Pin button trovato per la chiave: ${key}`, pinButton);

        // Trova l'elemento .nav-link più vicino
        let navLink = pinButton.closest('.nav-link');
        if (!navLink) {
            // Se .nav-link non è un antenato diretto, cerca all'interno del genitore .nav-item
            const navItem = pinButton.closest('.nav-item');
            if (navItem) {
                navLink = navItem.querySelector('.nav-link');
            }
        }

        if (!navLink) {
            logger.error(`Elemento '.nav-link' non trovato per la chiave: ${key}`);
            return;
        }

        // Log per verificare il navLink
        logger.log(`Elemento '.nav-link' trovato per la chiave: ${key}`, navLink);

        // Aggiorna l'icona del pin
        pinButton.textContent = isPinned ? '📌' : '📍';
        logger.log(`Icona del pin aggiornata per la chiave: ${key} a ${isPinned ? '📌' : '📍'}`);

        // Aggiorna la classe 'pinned'
        navLink.classList.toggle('pinned', isPinned);
        logger.log(`Classe 'pinned' ${isPinned ? 'aggiunta' : 'rimossa'} per la chiave: ${key}`);
    };



    // ==== FINE NUOVE FUNZIONI ==== //

    /**
     * Crea un contenitore per una norma.
     * @param {Object} normaData - Dati della norma.
     * @returns {Object} - Riferimenti agli elementi creati.
     */
    const createNormContainer = (normaData) => {
    const template = document.getElementById('norm-collapsible-template');
    if (!template || !elements.normeContainer) {
        logger.error("Template 'norm-collapsible-template' o 'norme-container' non trovato.");
        return;
    }

    const normContainerFragment = template.content.cloneNode(true);
    const normContainer = normContainerFragment.querySelector('.norm-collapsible');
    const normHeader = normContainer.querySelector('.norm-header');
    const normTitle = normHeader.querySelector('.norm-title');
    const collapseElement = normContainer.querySelector('.norm-content');
    // Genera una chiave consistente senza numero_articolo
    const normaKey = generateNormaKey(normaData);
    const collapseId = `collapse-${normaKey}`;

    normTitle.textContent = `${capitalizeFirstLetter(normaData.tipo_atto)} ${normaData.numero_atto || ''} ${normaData.data || ''}`.trim();
    collapseElement.id = collapseId;
    normHeader.setAttribute('data-bs-target', `#${collapseId}`);
    normContainer.setAttribute('data-norma-key', normaKey);

    // Se nei dati della norma è presente 'urn', aggiungi un pulsante per esportare il PDF
    if (normaData.urn) {
        const exportBtn = document.createElement('button');
        exportBtn.classList.add('btn', 'btn-info', 'btn-sm');
        exportBtn.textContent = 'Esporta PDF';
        exportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            viewPDF(normaData.urn);
        });
        normHeader.appendChild(exportBtn);
    }
    
    

    elements.normeContainer.appendChild(normContainerFragment);
    logger.log(`Contenitore per la norma creato: ${normTitle.textContent}`);

    return {
        normContainer,
        normTabs: normContainer.querySelector('.norm-tabs'),
        normTabContent: normContainer.querySelector('.norm-tab-content'),
        normaKey,
    };
};


    /**
     * Crea un tab per un articolo all'interno di una norma.
     * @param {Object} articleData - Dati dell'articolo.
     * @param {Object} normElements - Riferimenti agli elementi della norma.
     * @param {boolean} isPinned - Se true, il tab viene creato come pinnato.
     */
    const createArticleTab = (articleData, normElements, isPinned = false) => {
        const { normTabs, normTabContent, normaKey } = normElements;
        const { norma_data: normaData } = articleData;
    
        if (!normaData) {
            logger.warn('Dati della norma mancanti:', articleData);
            return;
        }
    
        // Genera la chiave unica per l'articolo
        const key = generateArticleKey(normaData);
        const articleTabId = `article-${sanitize(key)}`;
    
        // Verifica se il tab già esiste
        if (normTabs.querySelector(`#${articleTabId}-tab`)) {
            logger.log(`Tab già presente: ${articleTabId}-tab`);
            return;
        }
    
        // Creazione del tab
        const tabTemplate = document.getElementById('article-tab-template');
        if (!tabTemplate) {
            logger.error("Template 'article-tab-template' non trovato.");
            return;
        }
    
        const tabItem = tabTemplate.content.cloneNode(true);
        const navLink = tabItem.querySelector('.nav-link');
        navLink.id = `${articleTabId}-tab`;
        navLink.href = `#${articleTabId}`;
        navLink.setAttribute('aria-controls', articleTabId);
        navLink.textContent = `Articolo ${normaData.numero_articolo || 'N/A'}`.trim();
    
        const pinButton = tabItem.querySelector('.pin-button');
        pinButton.dataset.key = key;
    
        const closeButton = tabItem.querySelector('.close-button');
        closeButton.dataset.key = key;
    
        // Aggiungi il tab al DOM
        normTabs.appendChild(tabItem);
        logger.log(`Tab aggiunto: ${navLink.textContent}`);
        enableTabSorting();
    
        // Aggiorna l'icona del pin
        updatePinIcon(isPinned, key);
    
        // Creazione del contenuto del tab
        const paneTemplate = document.getElementById('article-tab-pane-template');
        if (!paneTemplate) {
            logger.error("Template 'article-tab-pane-template' non trovato.");
            return;
        }
    
        const tabPane = paneTemplate.content.cloneNode(true);
        const paneDiv = tabPane.querySelector('.tab-pane');
        paneDiv.id = articleTabId;
        paneDiv.setAttribute('aria-labelledby', `${articleTabId}-tab`);
        
        const normaDetailsDiv = document.createElement('div');
        normaDetailsDiv.classList.add('norma-details', 'mb-3');
        normaDetailsDiv.innerHTML = `
        <strong>Versione:</strong> ${articleData.versione || 'N/A'} &nbsp;&nbsp;
        <strong>Data Versione:</strong> ${articleData.data_versione || 'N/A'} &nbsp;&nbsp;
        <strong>Allegato:</strong> ${articleData.allegato || 'N/A'}
        `;
        paneDiv.insertBefore(normaDetailsDiv, paneDiv.querySelector('.article-text-container'));

        // Inizializza CKEditor nel contenitore dell'articolo
        const textArea = paneDiv.querySelector('.article-text');
        
        // Verifica se il testo dell'articolo è in formato HTML o testo puro
        let formattedText = articleData.article_text || '';
    
        // Se il testo contiene caratteri di nuova riga e non è già in HTML, convertili in <br>
        if (!formattedText.includes('<br>') && !formattedText.includes('<p>')) {
            formattedText = formattedText.replace(/\n/g, '<br>');
        }
    
        // Imposta il valore del textarea con l'HTML corretto
        textArea.value = formattedText;
    
        // Inizializza CKEditor
        const { ClassicEditor, Essentials, Bold, Italic, Underline, Strikethrough, FontSize, Highlight, Paragraph } = CKEDITOR;
    
        ClassicEditor.create(textArea, {
            plugins: [Essentials, Bold, Italic, Underline, Strikethrough, Highlight, Paragraph],
            toolbar: ['undo', 'redo', '|', 'bold', 'italic', 'underline', 'strikethrough', '|', 'highlight'],
            highlight: {
                options: [
                    {
                        model: 'yellowMarker',
                        class: 'marker-yellow',
                        title: 'Yellow marker',
                        color: 'var(--ck-highlight-marker-yellow)',
                        type: 'marker'
                    },
                    {
                        model: 'greenMarker',
                        class: 'marker-green',
                        title: 'Green marker',
                        color: 'var(--ck-highlight-marker-green)',
                        type: 'marker'
                    }
                ]
            }
        })
        .then(editor => {
            logger.log(`Editor CKEditor inizializzato per: ${articleTabId}`, editor);
        
            // Salva il riferimento all'editor
            articleData.editor = editor;
        
            editor.model.document.on('change:data', () => {
                logger.log(`Contenuto modificato per: ${articleTabId}`);
            });
        })
        .catch(error => {
            logger.error(`Errore durante l'inizializzazione di CKEditor per: ${articleTabId}`, error);
        });
        
    
        // Popola informazioni aggiuntive (Brocardi, link Normattiva)
        const brocardiInfoDiv = paneDiv.querySelector('.brocardi-info');
        if (articleData.brocardi_info && Object.keys(articleData.brocardi_info).length > 0) {
            brocardiInfoDiv.style.display = 'block';
            populateBrocardiInfo(articleData.brocardi_info, brocardiInfoDiv);
            logger.log(`Informazioni Brocardi aggiunte per: ${articleTabId}`);
        } else {
            brocardiInfoDiv.style.display = 'none';
        }
    
        if (normaData.urn) {
            const normattivaLinkDiv = document.createElement('div');
            normattivaLinkDiv.classList.add('normattiva-link');
            const normattivaHeading = document.createElement('h6');
            normattivaHeading.textContent = 'Fonte Normattiva:';
            const normattivaLink = document.createElement('a');
            normattivaLink.href = normaData.urn;
            normattivaLink.target = '_blank';
            normattivaLink.rel = 'noopener noreferrer';
            normattivaLink.textContent = 'Visualizza su Normattiva';
            normattivaLinkDiv.appendChild(normattivaHeading);
            normattivaLinkDiv.appendChild(normattivaLink);
            paneDiv.appendChild(normattivaLinkDiv);
        }
    
        // Aggiungi il pane al contenitore
        normTabContent.appendChild(paneDiv);
        logger.log(`Pane aggiunto: ${paneDiv.id}`);
    
        navLink.addEventListener('click', (event) => {
            event.preventDefault();
            if (navLink.classList.contains('active')) {
                navLink.classList.remove('active');
                paneDiv.classList.remove('show', 'active');
            } else {
                const activeTab = normTabs.querySelector('.nav-link.active');
                if (activeTab) {
                    activeTab.classList.remove('active');
                    const activePaneId = activeTab.getAttribute('href');
                    const activePane = normTabContent.querySelector(activePaneId);
                    if (activePane) {
                        activePane.classList.remove('show', 'active');
                    }
                }
                navLink.classList.add('active');
                paneDiv.classList.add('show', 'active');
            }
        });
    
        pinButton.addEventListener('click', (event) => {
            event.stopPropagation();
            togglePin(key, articleData);
        });
    
        closeButton.addEventListener('click', (event) => {
            event.stopPropagation();
            const tabElement = closeButton.closest('li');
            const paneId = navLink.getAttribute('href');
            const paneElement = normTabContent.querySelector(paneId);
    
            // Distruggi l'istanza di CKEditor prima di rimuovere il tab
            if (articleData.editor) {
                articleData.editor.destroy()
                    .then(() => logger.log(`Editor CKEditor distrutto per: ${paneId}`))
                    .catch(error => logger.error(`Errore durante la distruzione di CKEditor per: ${paneId}`, error));
            }
    
            tabElement?.remove();
            paneElement?.remove();
            logger.log(`Tab e pane rimossi: ${paneId}`);
    
            if (pinnedTabs[key]) {
                delete pinnedTabs[key];
                savePinnedTabs();
            }
    
            if (normTabs.querySelectorAll('.nav-link').length === 0) {
                normElements.normContainer.remove();
                delete normaContainers[normaKey];
            }
        });
    };
        
    
    /**
     * Visualizza i risultati ottenuti dalla ricerca.
     * @param {Array} results - Array di risultati.
     */
    const displayResults = (results) => {
        if (!elements.normeContainer) {
            logger.error("Elemento 'norme-container' non trovato nel DOM.");
            return;
        }

        const normaDict = {};

        results.forEach((result) => {
            const normaData = result.norma_data;
            if (!normaData) {
                logger.warn('Dati della norma mancanti nel risultato:', result);
                return;
            }
            // Genera normaKey senza numero_articolo
            const normaKey = generateNormaKey(normaData);

            normaDict[normaKey] = normaDict[normaKey] || {
                norma_data: normaData,
                articles: [],
            };

            normaDict[normaKey].articles.push(result);
        });

        Object.values(normaDict).forEach((norma) => {
            const normaKey = generateNormaKey(norma.norma_data);
            let normElements = normaContainers[normaKey];

            if (!normElements) {
                normElements = createNormContainer(norma.norma_data);
                normaContainers[normaKey] = normElements;
            }

            norma.articles.forEach((articleData) => {
                createArticleTab(articleData, normElements);
            });
        });

        logger.log('Risultati visualizzati.');
    };

    /**
     * Rimuove tutti gli articoli non pinnati e le norme vuote.
     */
    const removeNonPinnedArticles = () => {
        Object.entries(normaContainers).forEach(([normaKey, normElements]) => {
            const { normContainer, normTabs, normTabContent } = normElements;

            normTabs.querySelectorAll('.nav-link').forEach((navLink) => {
                const key = navLink.querySelector('.pin-button')?.dataset.key;
                if (key && !pinnedTabs[key]) {
                    const tabElement = navLink.closest('li');
                    const paneId = navLink.getAttribute('href');
                    const paneElement = normTabContent.querySelector(paneId);

                    tabElement?.remove();
                    paneElement?.remove();

                    logger.log(`Articolo non pinnato rimosso: ${key}`);
                }
            });

            if (normTabs.querySelectorAll('.nav-link').length === 0) {
                normContainer.remove();
                delete normaContainers[normaKey];
                logger.log(`Norma rimossa perché vuota: ${normaKey}`);
            }
        });
    };

    // ============================
    // Gestione degli Eventi
    // ============================
/**
 * Gestisce l'invio del form per estrarre dati delle norme.
 * Utilizza l'endpoint '/fetch_all_data' se 'show_brocardi_info' è attivo,
 * altrimenti utilizza l'endpoint '/fetch_article_text'.
 * @param {Event} event - Evento di submit del form.
 */
const handleFormSubmit = async (event) => {
    event.preventDefault(); // Previene il comportamento predefinito del form
    hideError(); // Nasconde eventuali messaggi di errore precedenti
    logger.log('Form inviato.');

    // Verifica la validità del form
    if (!elements.scrapeForm.checkValidity()) {
        event.stopPropagation();
        elements.scrapeForm.classList.add('was-validated'); // Aggiunge classe per validazione Bootstrap
        logger.log('Form non valido.');
        return;
    }

    elements.scrapeForm.classList.remove('was-validated'); // Rimuove la classe di validazione
    logger.log('Form validato.');

    elements.loadingIndicator.style.display = 'block'; // Mostra l'indicatore di caricamento
    logger.log('Loading indicator mostrato.');

    // Raccoglie i dati dal form
    const formData = new FormData(elements.scrapeForm);
    const data = Object.fromEntries(formData.entries());
    data.article = elements.articleInput.value; // Aggiunge il valore dell'input 'article'

    // Se l'utente vuole anche le info Brocardi, usa l'endpoint non-streaming
    const wantsBrocardi = document.getElementById('show_brocardi_info')?.checked === true;
    const endpoint = wantsBrocardi ? '/fetch_all_data' : '/stream_article_text';
    logger.log(`Endpoint selezionato: ${endpoint}`);

    try {
        if (wantsBrocardi) {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!response.ok) throw new Error('Errore durante la richiesta al server.');
            const results = await response.json();
            displayResults(results);
            return;
        }

        // Altrimenti mantieni lo streaming per una UX più reattiva
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            throw new Error('Errore durante la richiesta al server.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop();
            for (let line of lines) {
                if (!line.trim()) continue;
                try { appendResult(JSON.parse(line)); }
                catch (err) { logger.error("Errore durante il parsing del JSON:", err); }
            }
        }
        if (buffer.trim()) {
            try { appendResult(JSON.parse(buffer)); }
            catch (err) { logger.error("Errore durante il parsing finale del JSON:", err); }
        }
        logger.log("Streaming completato.");
    } catch (error) {
        showError(error.message || 'Si è verificato un errore. Riprova più tardi.');
        logger.error('Errore:', error);
    } finally {
        elements.loadingIndicator.style.display = 'none'; // Nasconde l'indicatore di caricamento
        logger.log('Loading indicator nascosto.');
    }
};


    const handleIncrement = () => {
        const currentValue = parseInt(elements.articleInput.value, 10);
        elements.articleInput.value = isNaN(currentValue) ? 1 : currentValue + 1;
        logger.log(`Articolo incrementato a: ${elements.articleInput.value}`);
    };

    const handleDecrement = () => {
        const currentValue = parseInt(elements.articleInput.value, 10);
        if (!isNaN(currentValue) && currentValue > 1) {
            elements.articleInput.value = currentValue - 1;
            logger.log(`Articolo decrementato a: ${elements.articleInput.value}`);
        }
    };

    const handleResetForm = () => {
        // Mostra il modal di conferma
        const resetModalElement = document.getElementById('resetConfirmationModal');
        if (!resetModalElement) {
            logger.error("Modal di conferma 'resetConfirmationModal' non trovato nel DOM.");
            return;
        }
        const resetModal = new bootstrap.Modal(resetModalElement);
        resetModal.show();

        // Aggiungi un listener per il pulsante di conferma nel modal
        const confirmResetButton = document.getElementById('confirmResetButton');
        if (!confirmResetButton) {
            logger.error("Pulsante 'confirmResetButton' non trovato nel DOM.");
            return;
        }

        const handleConfirmReset = () => {
            // Resetta il modulo e rimuove la validazione
            elements.scrapeForm.reset();
            elements.scrapeForm.classList.remove('was-validated');
            logger.log('Form resettato.');

            // Aggiorna i dettagli dell'atto e la data della versione
            toggleActDetails();
            toggleVersionDate();

            // Rimuove tutti gli articoli non pinnati e le norme vuote
            removeNonPinnedArticles();
            logger.log('Articoli non pinnati rimossi.');

            // Svuota i pinnedTabs e aggiorna l'interfaccia
            pinnedTabs = {}; // Resetta la variabile
            savePinnedTabs(); // Salva lo stato aggiornato (cancellando 'pinnedTabs' in localStorage)
            logger.log('Pinned tabs svuotati.');

            // Rimuovi tutti i tab pinnati dall'interfaccia
            Object.values(normaContainers).forEach(({ normTabs, normTabContent }) => {
                normTabs.querySelectorAll('.nav-link.pinned').forEach((navLink) => {
                    const key = navLink.querySelector('.pin-button')?.dataset.key;
                    if (key) {
                        const tabElement = navLink.closest('li');
                        const paneId = navLink.getAttribute('href');
                        const paneElement = normTabContent.querySelector(paneId);

                        tabElement?.remove();
                        paneElement?.remove();
                        logger.log(`Tab pinnato rimosso: ${key}`);
                    }
                });

                // Se dopo la rimozione non ci sono più tab, rimuovi il contenitore della norma
                if (normTabs.querySelectorAll('.nav-link.pinned').length === 0) {
                    const normaKey = Object.keys(normaContainers).find(key => normaContainers[key].normTabs === normTabs);
                    if (normaKey) {
                        normaContainers[normaKey].normContainer.remove();
                        delete normaContainers[normaKey];
                        logger.log(`Norma rimossa perché non ci sono più tab pinnati: ${normaKey}`);
                    }
                }
            });

            logger.log('Form resettato, localStorage svuotato e tab pinnati rimossi.');

            // Rimuovi l'evento listener per evitare duplicazioni
            confirmResetButton.removeEventListener('click', handleConfirmReset);

            // Nascondi il modal
            resetModal.hide();
        };

        confirmResetButton.addEventListener('click', handleConfirmReset);
    };

    const handleClearSearchFields = () => {
        elements.scrapeForm.reset();
        elements.scrapeForm.classList.remove('was-validated');
        logger.log('Campi di ricerca cancellati.');

        toggleActDetails();
        toggleVersionDate();
    };

    const handleResetHistory = () => {
        if (!elements.historyList) {
            logger.error("Elemento 'history-list' non trovato nel DOM.");
            return;
        }
        elements.historyList.innerHTML = '';
        logger.log('Cronologia resettata.');
    };

    const handleHistorySearch = debounce(() => {
        if (!elements.historySearchInput || !elements.historyList) return;

        const query = elements.historySearchInput.value.toLowerCase();
        elements.historyList.querySelectorAll('li').forEach((item) => {
            item.style.display = item.textContent.toLowerCase().includes(query) ? '' : 'none';
        });
        logger.log(`Filtrata la cronologia con la query: ${query}`);
    }, 300);

        // Aggiungi la funzione enableTabSorting con SortableJS
        const enableTabSorting = () => {
            const navTabsLists = document.querySelectorAll('.nav-tabs');
        
            navTabsLists.forEach((navTabs) => {
                new Sortable(navTabs, {
                    group: 'shared-tabs', // Se vuoi permettere il drag-and-drop tra gruppi
                    animation: 150,
                    handle: '.nav-item',
                    direction: 'vertical', // Modifica la direzione in 'vertical' per il drag verticale
                    onEnd: function (evt) {
                        // Aggiorna l'ordine dei contenuti delle tab
                        updateTabContentOrder(navTabs);
                        logger.log('Ordine delle tab aggiornato con SortableJS.');
                    },
                });
            });
        };
        
    
        // Assicurati che la funzione updateTabContentOrder sia presente
        const updateTabContentOrder = (navTabs) => {
            const tabContent = navTabs.closest('.norm-content').querySelector('.tab-content');
            const tabs = navTabs.querySelectorAll('.nav-link');
    
            tabs.forEach((tab) => {
                const paneId = tab.getAttribute('href');
                const pane = tabContent.querySelector(paneId);
                if (pane) {
                    tabContent.appendChild(pane);
                }
            });
        };
    
    // ============================
    // Inizializzazione degli Event Listeners
    // ============================
    const initializeEventListeners = () => {
        if (elements.actTypeSelect) {
            elements.actTypeSelect.addEventListener('change', toggleActDetails);
        }

        if (elements.versionRadios) {
            elements.versionRadios.forEach((radio) => radio.addEventListener('change', toggleVersionDate));
        }

        if (elements.scrapeForm) {
            elements.scrapeForm.addEventListener('submit', handleFormSubmit);
        }

        if (elements.incrementButton) {
            elements.incrementButton.addEventListener('click', handleIncrement);
        }

        if (elements.decrementButton) {
            elements.decrementButton.addEventListener('click', handleDecrement);
        }

        if (elements.resetButton) {
            elements.resetButton.addEventListener('click', handleResetForm);
        }

        if (elements.clearSearchFieldsButton) {
            elements.clearSearchFieldsButton.addEventListener('click', handleClearSearchFields);
        }

        if (elements.resetHistoryButton) {
            elements.resetHistoryButton.addEventListener('click', handleResetHistory);
        }

        if (elements.historySearchInput) {
            elements.historySearchInput.addEventListener('input', handleHistorySearch);
        }

        logger.log('Event listeners inizializzati.');
    };

    // ============================
    // Inizializzazione
    // ============================
    const initialize = () => {
        toggleActDetails();
        toggleVersionDate();
        loadPinnedTabs(); // Carica i tab pinnati all'avvio
        enableTabSorting(); // Abilita il riordino delle tab
        initializeEventListeners();
        logger.log('Inizializzazione completata.');
    };

    initialize();
});
