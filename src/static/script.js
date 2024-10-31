document.addEventListener('DOMContentLoaded', () => {
    // ============================
    // Configurazione e Costanti
    // ============================
    const DEBUG = true; // Imposta su false per disabilitare i log di debug

    const logger = {
        log: (...args) => { if (DEBUG) console.log(...args); },
        error: (...args) => { console.error(...args); },
        warn: (...args) => { if (DEBUG) console.warn(...args); },
    };

    const ACT_TYPES_REQUIRING_DETAILS = [
        'legge',
        'decreto legge',
        'decreto legislativo',
        'Regolamento UE',
        'Direttiva UE'
    ];

    const SELECTORS = {
        scrapeForm: '#scrape-form',
        normaDataContainer: '#norma-data',
        articlesContainer: '#articles-container',
        articlesTabs: '#articles-tabs',
        articlesTabContent: '#articles-tab-content',
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
    const elements = {
        scrapeForm: document.querySelector(SELECTORS.scrapeForm),
        normaDataContainer: document.querySelector(SELECTORS.normaDataContainer),
        articlesContainer: document.querySelector(SELECTORS.articlesContainer),
        articlesTabs: document.querySelector(SELECTORS.articlesTabs),
        articlesTabContent: document.querySelector(SELECTORS.articlesTabContent),
        loadingIndicator: document.querySelector(SELECTORS.loadingIndicator),
        errorContainer: document.querySelector(SELECTORS.errorContainer),
        historyList: document.querySelector(SELECTORS.historyList),
        resetHistoryButton: document.querySelector(SELECTORS.resetHistoryButton),
        resetButton: document.querySelector(SELECTORS.resetButton),
        clearSearchFieldsButton: document.querySelector(SELECTORS.clearSearchFieldsButton),
        historySearchInput: document.querySelector(SELECTORS.historySearchInput),
        actTypeSelect: document.querySelector(SELECTORS.actTypeSelect),
        actNumberInput: document.querySelector(SELECTORS.actNumberInput),
        dateInput: document.querySelector(SELECTORS.dateInput),
        versionRadios: document.querySelectorAll(SELECTORS.versionRadios),
        versionDateInput: document.querySelector(SELECTORS.versionDateInput),
        articleInput: document.querySelector(SELECTORS.articleInput),
        incrementButton: document.querySelector(SELECTORS.incrementButton),
        decrementButton: document.querySelector(SELECTORS.decrementButton),
    };

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

    // ============================
    // Funzioni di Utilità
    // ============================
    /**
     * Mostra un messaggio di errore.
     * @param {string} message - Il messaggio di errore da mostrare.
     */
    const showError = (message) => {
        if (elements.errorContainer) {
            elements.errorContainer.textContent = message;
            elements.errorContainer.style.display = 'block';
            logger.error('Errore:', message);
        } else {
            logger.error("Elemento 'error-container' non trovato nel DOM.");
        }
    };

    /**
     * Nasconde il messaggio di errore.
     */
    const hideError = () => {
        if (elements.errorContainer) {
            elements.errorContainer.textContent = '';
            elements.errorContainer.style.display = 'none';
        }
    };

    /**
     * Crea una funzione che ritarda l'esecuzione fino a quando non viene chiamata nuovamente entro il periodo di ritardo.
     * @param {Function} func - La funzione da debouncizzare.
     * @param {number} delay - Il ritardo in millisecondi.
     * @returns {Function} - La funzione debouncizzata.
     */
    const debounce = (func, delay) => {
        let debounceTimer;
        return function(...args) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => func.apply(this, args), delay);
        };
    };

    /**
     * Sanifica una stringa per utilizzarla come ID HTML valido.
     * @param {string} str - La stringa da sanificare.
     * @returns {string} - La stringa sanificata.
     */
    const sanitize = (str) => {
        return str.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();
    };

    /**
     * Capitalizza la prima lettera di una stringa.
     * @param {string} string - La stringa da capitalizzare.
     * @returns {string} - La stringa capitalizzata.
     */
    const capitalizeFirstLetter = (string) => {
        return string.charAt(0).toUpperCase() + string.slice(1);
    };

    /**
     * Salva i tab pinnati nel localStorage.
     */
    const savePinnedTabs = () => {
        try {
            localStorage.setItem('pinnedTabs', JSON.stringify(pinnedTabs));
            logger.log('Pinned tabs salvati:', pinnedTabs);
        } catch (error) {
            logger.error('Impossibile salvare i tab pinnati:', error);
        }
    };

    /**
     * Carica i tab pinnati dal localStorage.
     */
    const loadPinnedTabs = () => {
        if (localStorage && elements.articlesTabs && elements.articlesTabContent) {
            try {
                const savedPinnedTabs = localStorage.getItem('pinnedTabs');
                if (savedPinnedTabs) {
                    pinnedTabs = JSON.parse(savedPinnedTabs);
                    logger.log('Tab pinnati trovati:', pinnedTabs);
                    Object.values(pinnedTabs).forEach(result => {
                        createArticleTab(result, true); // Passa true per indicare che è pinnato
                    });
                    activateFirstPinnedTab();
                } else {
                    logger.log("Nessun tab pinnato salvato.");
                }
            } catch (error) {
                logger.error('Errore nel caricamento dei tab pinnati:', error);
            }
        } else {
            if (!localStorage) logger.warn("localStorage non è supportato.");
            if (!elements.articlesTabs) logger.error("Elemento 'articles-tabs' non trovato nel DOM.");
            if (!elements.articlesTabContent) logger.error("Elemento 'articles-tab-content' non trovato nel DOM.");
        }
    };

    /**
     * Attiva il primo tab pinnato disponibile.
     */
    const activateFirstPinnedTab = () => {
        const firstPinnedTab = elements.articlesTabs.querySelector('.nav-link.pinned');
        if (firstPinnedTab) {
            firstPinnedTab.classList.add('active');
            const firstPinnedPaneId = firstPinnedTab.getAttribute('href');
            const firstPinnedPane = elements.articlesTabContent.querySelector(firstPinnedPaneId);
            if (firstPinnedPane) {
                firstPinnedPane.classList.add('show', 'active');
                logger.log(`Pane attivato: ${firstPinnedPaneId}`);
            } else {
                logger.warn(`Pane con id '${firstPinnedPaneId}' non trovato.`);
            }
        }
    };

    /**
     * Salva una ricerca nella cronologia.
     * @param {Object} data - I dati della ricerca.
     */
    const saveToHistory = (data) => {
        if (!elements.historyList) return;
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item';
        listItem.textContent = `${capitalizeFirstLetter(data.act_type || 'N/A')} ${data.act_number || 'N/A'}, Articolo ${data.article || 'N/A'}`;
        elements.historyList.appendChild(listItem);
        logger.log('Ricerca salvata nella cronologia:', listItem.textContent);
    };

    /**
     * Popola le informazioni Brocardi in un elemento specificato.
     * @param {Object} brocardiInfo - Le informazioni Brocardi da visualizzare.
     * @param {HTMLElement} brocardiInfoDiv - Il contenitore dove inserire le informazioni.
     */
    const populateBrocardiInfo = (brocardiInfo, brocardiInfoDiv) => {
        if (!brocardiInfoDiv) return;
        const brocardiContentDiv = brocardiInfoDiv.querySelector('.brocardi-content');
        if (!brocardiContentDiv) return;

        brocardiContentDiv.innerHTML = ''; // Resetta il contenuto

        /**
         * Crea e aggiunge una sezione al contenuto Brocardi.
         * @param {string} title - Il titolo della sezione.
         * @param {string|Array} content - Il contenuto della sezione.
         * @param {boolean} isList - Indica se il contenuto è una lista.
         */
        const createSection = (title, content, isList = false) => {
            const sectionDiv = document.createElement('div');
            sectionDiv.classList.add('brocardi-section');

            if (title === 'Massime') {
                sectionDiv.classList.add('massime-section');
            } else if (title === 'Ratio') {
                sectionDiv.classList.add('ratio-section');
            } else if (title === 'Spiegazione') {
                sectionDiv.classList.add('spiegazione-section');
            }

            const heading = document.createElement('h6');
            heading.textContent = `${title}:`;
            sectionDiv.appendChild(heading);

            if (isList && Array.isArray(content)) {
                const listContainer = document.createElement('div');
                listContainer.classList.add(`${title.toLowerCase()}-content`);
                content.forEach(item => {
                    const itemBox = document.createElement('div');
                    itemBox.classList.add(title === 'Massime' ? 'massime-item' : 'brocardi-item', 'resizable');
                    itemBox.innerHTML = item.trim();
                    listContainer.appendChild(itemBox);
                });
                sectionDiv.appendChild(listContainer);
            } else if (typeof content === 'string') {
                const paragraph = document.createElement('p');
                paragraph.innerHTML = content.trim();
                sectionDiv.appendChild(paragraph);
            }

            brocardiContentDiv.appendChild(sectionDiv);
        };

        // Sezioni Brocardi
        if (brocardiInfo.Brocardi && brocardiInfo.Brocardi.length > 0) {
            createSection('Brocardi', brocardiInfo.Brocardi, true);
        }

        if (brocardiInfo.Ratio) {
            createSection('Ratio', brocardiInfo.Ratio);
        }

        if (brocardiInfo.Spiegazione) {
            createSection('Spiegazione', brocardiInfo.Spiegazione);
        }

        if (brocardiInfo.Massime && brocardiInfo.Massime.length > 0) {
            createSection('Massime', brocardiInfo.Massime, true);
        }

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

        logger.log('Informazioni Brocardi popolate.');
    };

    // ============================
    // Funzioni Principali
    // ============================
    /**
     * Abilita o disabilita i campi 'Numero Atto' e 'Data' in base al tipo di atto selezionato.
     */
    const toggleActDetails = () => {
        if (!elements.actTypeSelect || !elements.actNumberInput || !elements.dateInput) return;
        const selectedActType = elements.actTypeSelect.value;

        if (ACT_TYPES_REQUIRING_DETAILS.includes(selectedActType)) {
            elements.actNumberInput.disabled = false;
            elements.actNumberInput.required = true;
            elements.dateInput.disabled = false;
            elements.dateInput.required = true;
            elements.actNumberInput.classList.remove('disabled');
            elements.dateInput.classList.remove('disabled');
            logger.log(`Campi 'Numero Atto' e 'Data' abilitati per tipo atto: ${selectedActType}`);
        } else {
            elements.actNumberInput.disabled = true;
            elements.actNumberInput.required = false;
            elements.actNumberInput.value = '';
            elements.dateInput.disabled = true;
            elements.dateInput.required = false;
            elements.dateInput.value = '';
            elements.actNumberInput.classList.add('disabled');
            elements.dateInput.classList.add('disabled');
            logger.log(`Campi 'Numero Atto' e 'Data' disabilitati per tipo atto: ${selectedActType}`);
        }
    };

    /**
     * Abilita o disabilita il campo 'Data versione' in base alla versione selezionata.
     */
    const toggleVersionDate = () => {
        if (!elements.versionRadios || !elements.versionDateInput) return;
        const selectedVersion = document.querySelector('input[name="version"]:checked')?.value;

        if (selectedVersion === 'originale') {
            elements.versionDateInput.disabled = true;
            elements.versionDateInput.value = '';
            elements.versionDateInput.classList.add('disabled');
            logger.log("Campo 'Data versione' disabilitato.");
        } else {
            elements.versionDateInput.disabled = false;
            elements.versionDateInput.classList.remove('disabled');
            logger.log("Campo 'Data versione' abilitato.");
        }
    };

    /**
     * Crea un nuovo tab per un articolo.
     * @param {Object} result - I dati dell'articolo.
     * @param {boolean} isPinned - Se il tab deve essere pinnato.
     */
    const createArticleTab = (result, isPinned = false) => {
        if (!result.norma_data) {
            logger.warn('Dati della norma mancanti:', result);
            return;
        }

        const articleIdRaw = result.norma_data.numero_articolo || 'unknown';
        const actTypeRaw = result.norma_data.tipo_atto || 'unknown';
        const articleId = sanitize(articleIdRaw);
        const actType = sanitize(actTypeRaw);
        const articleTabId = `article-${actType}-${articleId}`;
        const key = `article-${actType}-${articleId}`;

        // Evita di duplicare i tab già presenti
        if (document.getElementById(`${articleTabId}-tab`)) {
            logger.log(`Tab già presente: ${articleTabId}-tab`);
            return;
        }

        // Clona il template per il tab articolo
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
        navLink.textContent = `Articolo ${articleIdRaw} (${capitalizeFirstLetter(actTypeRaw)})`;

        // Configura il pulsante di pin
        const pinButton = tabItem.querySelector('.pin-button');
        pinButton.dataset.key = key;
        if (isPinned) {
            pinButton.textContent = '📌';
            navLink.classList.add('pinned');
        } else {
            pinButton.textContent = '📍';
            navLink.classList.remove('pinned');
        }

        // Configura il pulsante di chiusura
        const closeButton = tabItem.querySelector('.close-button');
        closeButton.dataset.key = key;

        // Aggiungi il tab alla navigazione
        if (elements.articlesTabs) {
            elements.articlesTabs.appendChild(tabItem);
            logger.log(`Tab aggiunto: ${navLink.textContent}`);
        } else {
            logger.error("Elemento 'articles-tabs' non trovato nel DOM.");
            return;
        }

        // Clona il template per il contenuto del tab articolo
        const paneTemplate = document.getElementById('article-tab-pane-template');
        if (!paneTemplate) {
            logger.error("Template 'article-tab-pane-template' non trovato.");
            return;
        }
        const tabPane = paneTemplate.content.cloneNode(true);
        const paneDiv = tabPane.querySelector('.tab-pane');
        paneDiv.id = articleTabId;
        paneDiv.setAttribute('aria-labelledby', `${articleTabId}-tab`);
        paneDiv.role = 'tabpanel';
        const preElement = paneDiv.querySelector('pre.article-text');
        preElement.textContent = result.article_text || 'N/A';
        preElement.classList.add('resizable');

        // Aggiungi le informazioni Brocardi se disponibili
        if (isPinned || (result.brocardi_info && result.brocardi_info.position !== 'Not Available')) {
            const brocardiInfoDiv = paneDiv.querySelector('.brocardi-info');
            if (brocardiInfoDiv && result.brocardi_info) {
                brocardiInfoDiv.style.display = 'block';
                populateBrocardiInfo(result.brocardi_info, brocardiInfoDiv);
                logger.log(`Informazioni Brocardi aggiunte per: ${articleTabId}`);
            }
        }

        // Aggiungi il contenuto del tab
        if (elements.articlesTabContent) {
            elements.articlesTabContent.appendChild(tabPane);
            logger.log(`Pane aggiunto: ${paneDiv.id}`);
        } else {
            logger.error("Elemento 'articles-tab-content' non trovato nel DOM.");
            return;
        }

        // ============================
        // Event Listeners per i Pulsanti
        // ============================
        // Pulsante di pin
        pinButton.addEventListener('click', () => {
            if (pinnedTabs[key]) {
                // Unpin
                delete pinnedTabs[key];
                pinButton.textContent = '📍';
                navLink.classList.remove('pinned');
                logger.log(`Tab ${key} unpinned.`);
            } else {
                // Pin
                pinnedTabs[key] = result;
                pinButton.textContent = '📌';
                navLink.classList.add('pinned');
                logger.log(`Tab ${key} pinned.`);
            }
            savePinnedTabs();
        });

        // Pulsante di chiusura
        closeButton.addEventListener('click', () => {
            // Rimuovi il tab e il contenuto
            const tabElement = closeButton.closest('li');
            if (!tabElement) return;
            const paneId = navLink.getAttribute('href');
            const paneElement = elements.articlesTabContent.querySelector(paneId);

            if (tabElement) {
                tabElement.remove();
                logger.log(`Tab rimosso: ${paneId}`);
            }
            if (paneElement) {
                paneElement.remove();
                logger.log(`Pane rimosso: ${paneId}`);
            }

            // Rimuovi dal pinnedTabs se presente
            if (pinnedTabs[key]) {
                delete pinnedTabs[key];
                savePinnedTabs();
                logger.log(`Tab ${key} rimosso dai pinnati.`);
            }

            // Attiva il primo tab rimasto
            const remainingTab = elements.articlesTabs.querySelector('.nav-link:not(.pinned)');
            if (remainingTab) {
                remainingTab.classList.add('active');
                const remainingPaneId = remainingTab.getAttribute('href');
                const remainingPane = elements.articlesTabContent.querySelector(remainingPaneId);
                if (remainingPane) {
                    remainingPane.classList.add('show', 'active');
                    logger.log(`Pane attivato: ${remainingPaneId}`);
                }
            } else {
                if (elements.articlesContainer) {
                    elements.articlesContainer.style.display = 'none';
                    logger.log('Nessun tab rimasto. Contenitore articoli nascosto.');
                }
            }
        });
    };

    /**
     * Visualizza i risultati della ricerca.
     * @param {Array} results - I risultati da visualizzare.
     * @param {boolean} showBrocardi - Indica se mostrare le informazioni Brocardi.
     */
    const displayResults = (results, showBrocardi) => {
        // Mostra il contenitore degli articoli
        if (elements.articlesContainer) {
            elements.articlesContainer.style.display = 'block';
            logger.log('Contenitore articoli mostrato.');
        }

        // Pulisci i contenuti precedenti
        if (elements.normaDataContainer) elements.normaDataContainer.innerHTML = '';
        if (elements.articlesTabs) elements.articlesTabs.innerHTML = '';
        if (elements.articlesTabContent) elements.articlesTabContent.innerHTML = '';
        logger.log('Contenuti precedenti puliti.');

        // Aggiungi i tab pinnati
        Object.values(pinnedTabs).forEach(result => {
            createArticleTab(result, true); // Tab pinnati
        });

        // Itera sui risultati e crea tab per ogni articolo
        results.forEach((result, index) => {
            if (result.norma_data) {
                // Aggiorna le informazioni sulla norma solo una volta
                if (index === 0 && elements.normaDataContainer) {
                    const normaInfo = `
                        <div><strong>Tipo Atto:</strong> ${capitalizeFirstLetter(result.norma_data.tipo_atto) || 'N/A'}</div>
                        <div><strong>Numero Atto:</strong> ${result.norma_data.numero_atto || 'N/A'}</div>
                        <div><strong>Data:</strong> ${result.norma_data.data || 'N/A'}</div>
                    `;
                    elements.normaDataContainer.innerHTML = normaInfo;
                    logger.log('Informazioni sulla norma aggiornate.');
                }

                // **Correzione Importante: Passa isPinned = false per i nuovi tab**
                createArticleTab(result, false);
            } else {
                logger.warn('Dati della norma mancanti nel risultato:', result);
            }
        });

        // Attiva il primo tab non pinnato se presente
        const firstArticleTab = elements.articlesTabs.querySelector('.nav-link:not(.pinned)');
        if (firstArticleTab) {
            firstArticleTab.classList.add('active');
            const paneId = firstArticleTab.getAttribute('href');
            const firstArticleTabPane = elements.articlesTabContent.querySelector(paneId);
            if (firstArticleTabPane) {
                firstArticleTabPane.classList.add('show', 'active');
                logger.log(`Pane attivato: ${paneId}`);
            }
        }
    };

    // ============================
    // Gestione degli Eventi
    // ============================
    /**
     * Gestisce l'invio del form di scraping.
     * @param {Event} event - L'evento di submit del form.
     */
    const handleFormSubmit = async (event) => {
        event.preventDefault();
        hideError();
        logger.log("Form inviato.");

        if (!elements.scrapeForm.checkValidity()) {
            event.stopPropagation();
            elements.scrapeForm.classList.add('was-validated');
            logger.log("Form non valido.");
            return;
        }

        elements.scrapeForm.classList.remove('was-validated');
        logger.log("Form validato.");

        // Pulisci i contenuti precedenti
        if (elements.normaDataContainer) elements.normaDataContainer.innerHTML = '';
        if (elements.articlesContainer) elements.articlesContainer.style.display = 'none';
        if (elements.articlesTabs) elements.articlesTabs.innerHTML = '';
        if (elements.articlesTabContent) elements.articlesTabContent.innerHTML = '';
        logger.log("Contenuti precedenti puliti.");

        // Mostra il loading indicator
        if (elements.loadingIndicator) {
            elements.loadingIndicator.style.display = 'block';
            logger.log('Loading indicator mostrato.');
        }

        // Raccogli i dati del form
        const formData = new FormData(elements.scrapeForm);
        const data = Object.fromEntries(formData.entries());
        data.article = elements.articleInput.value;
        data.show_brocardi_info = formData.has('show_brocardi_info');
        logger.log('Dati raccolti dal form:', data);

        try {
            let results;
            if (data.show_brocardi_info) {
                // Se l'utente ha richiesto le informazioni Brocardi, chiama /fetch_all_data
                const response = await fetch('/fetch_all_data', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                if (!response.ok) {
                    throw new Error('Errore durante la richiesta al server.');
                }

                results = await response.json();
                logger.log('Risultati fetch_all_data:', results);
            } else {
                // Altrimenti, chiama separatamente /fetch_norma_data e /fetch_article_text
                const [normaDataResponse, articleTextResponse] = await Promise.all([
                    fetch('/fetch_norma_data', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(data)
                    }),
                    fetch('/fetch_article_text', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(data)
                    })
                ]);

                if (!normaDataResponse.ok || !articleTextResponse.ok) {
                    throw new Error('Errore durante la richiesta al server.');
                }

                const normaDataResult = await normaDataResponse.json();
                const articleTextResult = await articleTextResponse.json();

                // Combina i risultati
                results = articleTextResult.map((article, index) => ({
                    norma_data: normaDataResult.norma_data[index],
                    article_text: article.article_text
                }));
                logger.log('Risultati combinati:', results);
            }

            if (!results || results.length === 0) {
                throw new Error('Nessun risultato trovato.');
            }

            // Visualizza i risultati
            displayResults(results, data.show_brocardi_info);
            logger.log('Risultati visualizzati.');

            // Salva nella cronologia
            saveToHistory(data);
        } catch (error) {
            showError(error.message || 'Si è verificato un errore. Riprova più tardi.');
            logger.error('Errore:', error);
        } finally {
            // Nascondi il loading indicator
            if (elements.loadingIndicator) {
                elements.loadingIndicator.style.display = 'none';
                logger.log('Loading indicator nascosto.');
            }
        }
    };

    /**
     * Gestisce l'incremento del numero dell'articolo.
     */
    const handleIncrement = () => {
        const currentValue = parseInt(elements.articleInput.value, 10);
        elements.articleInput.value = isNaN(currentValue) ? 1 : currentValue + 1;
        logger.log(`Articolo incrementato a: ${elements.articleInput.value}`);
    };

    /**
     * Gestisce il decremento del numero dell'articolo.
     */
    const handleDecrement = () => {
        const currentValue = parseInt(elements.articleInput.value, 10);
        if (!isNaN(currentValue) && currentValue > 1) {
            elements.articleInput.value = currentValue - 1;
            logger.log(`Articolo decrementato a: ${elements.articleInput.value}`);
        }
    };

    /**
     * Resetta il form e ripristina lo stato iniziale.
     */
    const handleResetForm = () => {
        if (elements.scrapeForm) {
            elements.scrapeForm.reset();
            elements.scrapeForm.classList.remove('was-validated');
            logger.log('Form resettato.');
        }
        if (elements.normaDataContainer) elements.normaDataContainer.innerHTML = '';
        if (elements.articlesContainer) {
            elements.articlesContainer.style.display = 'none';
            logger.log('Contenitore articoli nascosto.');
        }
        if (elements.articlesTabs) elements.articlesTabs.innerHTML = '';
        if (elements.articlesTabContent) elements.articlesTabContent.innerHTML = '';
        toggleActDetails();
        toggleVersionDate();
        logger.log('Form resettato e campi aggiornati.');
    };

    /**
     * Cancella i campi di ricerca senza resettare l'intero form.
     */
    const handleClearSearchFields = () => {
        if (elements.scrapeForm) {
            elements.scrapeForm.reset();
            elements.scrapeForm.classList.remove('was-validated');
            logger.log('Campi di ricerca cancellati.');
        }
        toggleActDetails();
        toggleVersionDate();
        logger.log('Campi di ricerca cancellati e campi aggiornati.');
    };

    /**
     * Resetta la cronologia delle ricerche.
     */
    const handleResetHistory = () => {
        if (elements.historyList) {
            elements.historyList.innerHTML = '';
            logger.log('Cronologia resettata.');
        }
    };

    /**
     * Filtra la cronologia delle ricerche in base alla query.
     */
    const handleHistorySearch = debounce(() => {
        const query = elements.historySearchInput.value.toLowerCase();
        const listItems = elements.historyList.querySelectorAll('li');

        listItems.forEach(item => {
            const text = item.textContent.toLowerCase();
            item.style.display = text.includes(query) ? '' : 'none';
        });

        logger.log(`Filtrata la cronologia con la query: ${query}`);
    }, 300);

    /**
     * Sincronizza lo stato del pin per tutti i tab pinnati.
     */
    const syncPinStates = () => {
        Object.keys(pinnedTabs).forEach(key => {
            const tabId = key.replace('article-', '');
            const navLink = document.getElementById(`${key}-tab`);
            if (navLink) {
                navLink.classList.add('pinned');
                const pinButton = navLink.parentElement.querySelector('.pin-button');
                if (pinButton) {
                    pinButton.textContent = '📌';
                }
            }
        });
    };

    // ============================
    // Inizializzazione degli Event Listeners
    // ============================
    const initializeEventListeners = () => {
        // Cambio del Tipo di Atto
        if (elements.actTypeSelect) {
            elements.actTypeSelect.addEventListener('change', toggleActDetails);
            logger.log("Event listener aggiunto per 'act_type'.");
        }

        // Cambio della Versione
        if (elements.versionRadios && elements.versionRadios.length > 0) {
            elements.versionRadios.forEach(radio => {
                radio.addEventListener('change', toggleVersionDate);
            });
            logger.log("Event listener aggiunti per 'version'.");
        }

        // Invio del Form
        if (elements.scrapeForm) {
            elements.scrapeForm.addEventListener('submit', handleFormSubmit);
            logger.log("Event listener aggiunto per l'invio del form.");
        }

        // Incremento e Decremento Articolo
        if (elements.incrementButton && elements.articleInput) {
            elements.incrementButton.addEventListener('click', handleIncrement);
            logger.log("Event listener aggiunto per il pulsante di incremento.");
        }

        if (elements.decrementButton && elements.articleInput) {
            elements.decrementButton.addEventListener('click', handleDecrement);
            logger.log("Event listener aggiunto per il pulsante di decremento.");
        }

        // Pulsanti di Reset e Cancellazione
        if (elements.resetButton) {
            elements.resetButton.addEventListener('click', handleResetForm);
            logger.log("Event listener aggiunto per il pulsante di reset del form.");
        }

        if (elements.clearSearchFieldsButton) {
            elements.clearSearchFieldsButton.addEventListener('click', handleClearSearchFields);
            logger.log("Event listener aggiunto per il pulsante di cancellazione dei campi di ricerca.");
        }

        // Reset Cronologia
        if (elements.resetHistoryButton) {
            elements.resetHistoryButton.addEventListener('click', handleResetHistory);
            logger.log("Event listener aggiunto per il pulsante di reset della cronologia.");
        }

        // Ricerca nella Cronologia
        if (elements.historySearchInput) {
            elements.historySearchInput.addEventListener('input', handleHistorySearch);
            logger.log("Event listener aggiunto per la ricerca nella cronologia.");
        }
    };

    // ============================
    // Inizializzazione
    // ============================
    const initialize = () => {
        toggleActDetails();
        toggleVersionDate();
        loadPinnedTabs();
        initializeEventListeners();
        logger.log('Inizializzazione completata.');
    };

    // Avvia l'inizializzazione
    initialize();
});
