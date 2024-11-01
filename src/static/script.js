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

                // Raggruppa i tab pinnati per norma
                const normaDict = {};

                Object.values(pinnedTabs).forEach((articleData) => {
                    const { norma_data: normaData } = articleData;
                    if (!normaData) {
                        logger.warn('Dati della norma mancanti nell\'articolo pinnato:', articleData);
                        return;
                    }
                    const normaKey = `${normaData.tipo_atto}-${normaData.numero_atto || ''}-${normaData.data || ''}`;

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

        createSection('Brocardi', brocardiInfo.Brocardi, true);
        createSection('Ratio', brocardiInfo.Ratio);
        createSection('Spiegazione', brocardiInfo.Spiegazione);
        createSection('Massime', brocardiInfo.Massime, true);

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

    const createNormContainer = (normaData) => {
        const template = document.getElementById('norm-collapsible-template');
        if (!template || !elements.normeContainer) {
            logger.error("Template 'norm-collapsible-template' o 'norme-container' non trovato.");
            return;
        }

        const normContainerFragment = template.content.cloneNode(true);
        const normContainer = normContainerFragment.querySelector('.norm-collapsible');
        const normTitle = normContainer.querySelector('.norm-title');
        const collapseElement = normContainer.querySelector('.norm-content');
        const normaKey = `${normaData.tipo_atto}-${normaData.numero_atto || ''}-${normaData.data || ''}`;
        const collapseId = `collapse-${sanitize(normaData.tipo_atto)}-${sanitize(normaData.numero_atto || '')}-${Date.now()}`;

        normTitle.textContent = `${capitalizeFirstLetter(normaData.tipo_atto)} ${normaData.numero_atto || ''} ${normaData.data || ''}`;
        collapseElement.id = collapseId;
        normContainer.querySelector('.norm-header').setAttribute('data-bs-target', `#${collapseId}`);
        normContainer.setAttribute('data-norma-key', normaKey);

        elements.normeContainer.appendChild(normContainerFragment);
        logger.log(`Contenitore per la norma creato: ${normTitle.textContent}`);

        return {
            normContainer,
            normTabs: normContainer.querySelector('.norm-tabs'),
            normTabContent: normContainer.querySelector('.norm-tab-content'),
            normaKey,
        };
    };

    const createArticleTab = (articleData, normElements, isPinned = false) => {
        const { normTabs, normTabContent, normaKey } = normElements;
        const { norma_data: normaData } = articleData;

        if (!normaData) {
            logger.warn('Dati della norma mancanti:', articleData);
            return;
        }

        const articleIdRaw = normaData.numero_articolo || 'unknown';
        const articleId = sanitize(articleIdRaw);
        const actTypeRaw = normaData.tipo_atto || 'unknown';
        const actType = sanitize(actTypeRaw);
        const timestamp = Date.now();
        const articleTabId = `article-${actType}-${articleId}-${timestamp}`;
        const key = `article-${actType}-${articleId}-${timestamp}`;

        if (normTabs.querySelector(`#${articleTabId}-tab`)) {
            logger.log(`Tab già presente: ${articleTabId}-tab`);
            return;
        }

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
        navLink.textContent = `Articolo ${articleIdRaw}`;

        const pinButton = tabItem.querySelector('.pin-button');
        pinButton.dataset.key = key;
        pinButton.textContent = isPinned ? '📌' : '📍';
        navLink.classList.toggle('pinned', isPinned);

        const closeButton = tabItem.querySelector('.close-button');
        closeButton.dataset.key = key;

        articleData.tabElement = navLink;
        articleData.paneElementId = `#${articleTabId}`;

        normTabs.appendChild(tabItem);
        logger.log(`Tab aggiunto: ${navLink.textContent}`);

        const paneTemplate = document.getElementById('article-tab-pane-template');
        if (!paneTemplate) {
            logger.error("Template 'article-tab-pane-template' non trovato.");
            return;
        }
        const tabPane = paneTemplate.content.cloneNode(true);
        const paneDiv = tabPane.querySelector('.tab-pane');
        paneDiv.id = articleTabId;
        paneDiv.setAttribute('aria-labelledby', `${articleTabId}-tab`);

        const articleTextContainer = paneDiv.querySelector('.article-text-container');
        const preElement = paneDiv.querySelector('pre.article-text');
        if (articleData.article_text) {
            preElement.textContent = articleData.article_text;
        } else {
            articleTextContainer.style.display = 'none';
        }

        const brocardiInfoDiv = paneDiv.querySelector('.brocardi-info');
        if (articleData.brocardi_info && Object.keys(articleData.brocardi_info).length > 0) {
            brocardiInfoDiv.style.display = 'block';
            populateBrocardiInfo(articleData.brocardi_info, brocardiInfoDiv);
            logger.log(`Informazioni Brocardi aggiunte per: ${articleTabId}`);
        } else {
            brocardiInfoDiv.style.display = 'none';
        }

        normTabContent.appendChild(paneDiv);
        logger.log(`Pane aggiunto: ${paneDiv.id}`);

        const handleTabClick = (event) => {
            event.preventDefault();

            if (navLink.classList.contains('active')) {
                navLink.classList.remove('active');
                paneDiv.classList.remove('show', 'active');
                logger.log(`Tab disattivato: ${navLink.textContent}`);
            } else {
                const activeTab = normTabs.querySelector('.nav-link.active');
                if (activeTab) {
                    activeTab.classList.remove('active');
                    const activePaneId = activeTab.getAttribute('href');
                    const activePane = normTabContent.querySelector(activePaneId);
                    if (activePane) {
                        activePane.classList.remove('show', 'active');
                        logger.log(`Tab disattivato: ${activeTab.textContent}`);
                    }
                }

                navLink.classList.add('active');
                paneDiv.classList.add('show', 'active');
                logger.log(`Tab attivato: ${navLink.textContent}`);
            }

            const collapseElement = normElements.normContainer.querySelector('.collapse');
            if (collapseElement && !collapseElement.classList.contains('show')) {
                const collapseInstance = new bootstrap.Collapse(collapseElement);
                collapseInstance.show();
                logger.log('Contenitore norma mostrato.');
            }
        };

        navLink.addEventListener('click', handleTabClick);

        pinButton.addEventListener('click', (event) => {
            event.stopPropagation();
            if (pinnedTabs[key]) {
                delete pinnedTabs[key];
                pinButton.textContent = '📍';
                navLink.classList.remove('pinned');
                logger.log(`Tab ${key} unpinned.`);
            } else {
                pinnedTabs[key] = articleData;
                pinButton.textContent = '📌';
                navLink.classList.add('pinned');
                logger.log(`Tab ${key} pinned.`);
            }
            savePinnedTabs();
        });

        closeButton.addEventListener('click', (event) => {
            event.stopPropagation();
            const tabElement = closeButton.closest('li');
            const paneId = navLink.getAttribute('href');
            const paneElement = normTabContent.querySelector(paneId);

            tabElement?.remove();
            paneElement?.remove();
            logger.log(`Tab e pane rimossi: ${paneId}`);

            if (pinnedTabs[key]) {
                delete pinnedTabs[key];
                savePinnedTabs();
                logger.log(`Tab ${key} rimossa dai pinnati.`);
            }

            if (normTabs.querySelectorAll('.nav-link').length === 0) {
                normElements.normContainer.remove();
                delete normaContainers[normaKey];
                logger.log(`Norma rimossa: ${normaKey}`);
            }
        });
    };

    const displayResults = (results) => {
        if (!elements.normeContainer) {
            logger.error("Elemento 'norme-container' non trovato nel DOM.");
            return;
        }

        removeNonPinnedArticles();

        const normaDict = {};

        results.forEach((result) => {
            const normaData = result.norma_data;
            const key = `${normaData.tipo_atto}-${normaData.numero_atto || ''}-${normaData.data || ''}`;

            normaDict[key] = normaDict[key] || {
                norma_data: normaData,
                articles: [],
            };

            normaDict[key].articles.push(result);
        });

        Object.values(normaDict).forEach((norma) => {
            const normaKey = `${norma.norma_data.tipo_atto}-${norma.norma_data.numero_atto || ''}-${norma.norma_data.data || ''}`;
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
    const handleFormSubmit = async (event) => {
        event.preventDefault();
        hideError();
        logger.log('Form inviato.');

        if (!elements.scrapeForm.checkValidity()) {
            event.stopPropagation();
            elements.scrapeForm.classList.add('was-validated');
            logger.log('Form non valido.');
            return;
        }

        elements.scrapeForm.classList.remove('was-validated');
        logger.log('Form validato.');

        elements.loadingIndicator.style.display = 'block';
        logger.log('Loading indicator mostrato.');

        const formData = new FormData(elements.scrapeForm);
        const data = Object.fromEntries(formData.entries());
        data.article = elements.articleInput.value;
        data.show_brocardi_info = formData.has('show_brocardi_info');
        logger.log('Dati raccolti dal form:', data);

        try {
            const response = await fetch('/fetch_all_data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                throw new Error('Errore durante la richiesta al server.');
            }

            const results = await response.json();
            logger.log('Risultati fetch_all_data:', results);

            if (!results || results.length === 0) {
                throw new Error('Nessun risultato trovato.');
            }

            displayResults(results);
            saveToHistory(data);
        } catch (error) {
            showError(error.message || 'Si è verificato un errore. Riprova più tardi.');
            logger.error('Errore:', error);
        } finally {
            elements.loadingIndicator.style.display = 'none';
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
        elements.scrapeForm.reset();
        elements.scrapeForm.classList.remove('was-validated');
        logger.log('Form resettato.');

        toggleActDetails();
        toggleVersionDate();

        // Rimuove tutti gli articoli non pinnati e le norme vuote
        removeNonPinnedArticles();

        logger.log('Form resettato e stato aggiornato, elementi pinnati mantenuti.');
    };

    const handleClearSearchFields = () => {
        elements.scrapeForm.reset();
        elements.scrapeForm.classList.remove('was-validated');
        logger.log('Campi di ricerca cancellati.');

        toggleActDetails();
        toggleVersionDate();
    };

    const handleResetHistory = () => {
        elements.historyList.innerHTML = '';
        logger.log('Cronologia resettata.');
    };

    const handleHistorySearch = debounce(() => {
        const query = elements.historySearchInput.value.toLowerCase();
        elements.historyList.querySelectorAll('li').forEach((item) => {
            item.style.display = item.textContent.toLowerCase().includes(query) ? '' : 'none';
        });
        logger.log(`Filtrata la cronologia con la query: ${query}`);
    }, 300);

    // ============================
    // Inizializzazione degli Event Listeners
    // ============================
    const initializeEventListeners = () => {
        elements.actTypeSelect?.addEventListener('change', toggleActDetails);
        elements.versionRadios?.forEach((radio) => radio.addEventListener('change', toggleVersionDate));
        elements.scrapeForm?.addEventListener('submit', handleFormSubmit);
        elements.incrementButton?.addEventListener('click', handleIncrement);
        elements.decrementButton?.addEventListener('click', handleDecrement);
        elements.resetButton?.addEventListener('click', handleResetForm);
        elements.clearSearchFieldsButton?.addEventListener('click', handleClearSearchFields);
        elements.resetHistoryButton?.addEventListener('click', handleResetHistory);
        elements.historySearchInput?.addEventListener('input', handleHistorySearch);
        logger.log('Event listeners inizializzati.');
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

    initialize();
});
