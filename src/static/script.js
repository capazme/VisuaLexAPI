document.addEventListener('DOMContentLoaded', () => {
    // ============================
    // Riferimenti agli Elementi del DOM
    // ============================
    const scrapeForm = document.getElementById('scrape-form');
    const normaDataContainer = document.getElementById('norma-data');
    const articlesContainer = document.getElementById('articles-container');
    const articlesTabs = document.getElementById('articles-tabs');
    const articlesTabContent = document.getElementById('articles-tab-content');
    const loadingIndicator = document.getElementById('loading');
    const errorContainer = document.getElementById('error-container');
    const historyList = document.getElementById('history-list');
    const resetHistoryButton = document.getElementById('reset-history');
    const resetButton = document.getElementById('reset-button');
    const clearSearchFieldsButton = document.getElementById('clear-search-fields');
    const historySearchInput = document.getElementById('history-search');

    // ============================
    // Log degli Elementi
    // ============================
    console.log('scrapeForm:', scrapeForm);
    console.log('normaDataContainer:', normaDataContainer);
    console.log('articlesContainer:', articlesContainer);
    console.log('articlesTabs:', articlesTabs);
    console.log('articlesTabContent:', articlesTabContent);
    console.log('loadingIndicator:', loadingIndicator);
    console.log('errorContainer:', errorContainer);
    console.log('historyList:', historyList);
    console.log('resetHistoryButton:', resetHistoryButton);
    console.log('resetButton:', resetButton);
    console.log('clearSearchFieldsButton:', clearSearchFieldsButton);
    console.log('historySearchInput:', historySearchInput);

    // ============================
    // Variabili e Costanti
    // ============================
    const actTypesRequiringDetails = [
        'legge',
        'decreto legge',
        'decreto legislativo',
        'Regolamento UE',
        'Direttiva UE'
    ];

    let pinnedTabs = {};

    // ============================
    // Funzioni di Utilità
    // ============================
    function showError(message) {
        if (errorContainer) {
            errorContainer.textContent = message;
            errorContainer.style.display = 'block';
            console.error('Errore:', message);
        } else {
            console.error("Elemento 'error-container' non trovato nel DOM.");
        }
    }

    function hideError() {
        if (errorContainer) {
            errorContainer.textContent = '';
            errorContainer.style.display = 'none';
        }
    }

    function debounce(func, delay) {
        let debounceTimer;
        return function() {
            const context = this;
            const args = arguments;
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => func.apply(context, args), delay);
        };
    }

    function savePinnedTabs() {
        if (localStorage) {
            localStorage.setItem('pinnedTabs', JSON.stringify(pinnedTabs));
            console.log('Pinned tabs salvati:', pinnedTabs);
        }
    }

    function loadPinnedTabs() {
        console.log('Caricamento dei tab pinnati...');
        console.log('articlesTabs:', articlesTabs);
        console.log('articlesTabContent:', articlesTabContent);

        if (localStorage && articlesTabs && articlesTabContent) {
            const savedPinnedTabs = localStorage.getItem('pinnedTabs');
            if (savedPinnedTabs) {
                console.log('Tab pinnati trovati:', savedPinnedTabs);
                pinnedTabs = JSON.parse(savedPinnedTabs);
                for (const key in pinnedTabs) {
                    const result = pinnedTabs[key];
                    console.log(`Creazione del tab pinnato per: ${key}`);
                    createArticleTab(result, true);
                }
                // Attiva il primo tab pinnato
                const firstPinnedTab = articlesTabs.querySelector('.nav-link.pinned');
                if (firstPinnedTab) {
                    console.log("Attivazione del primo tab pinnato:", firstPinnedTab.textContent);
                    firstPinnedTab.classList.add('active');
                    const firstPinnedPaneId = firstPinnedTab.getAttribute('href');
                    const firstPinnedPane = articlesTabContent.querySelector(firstPinnedPaneId);
                    if (firstPinnedPane) {
                        firstPinnedPane.classList.add('show', 'active');
                        console.log(`Pane attivato: ${firstPinnedPaneId}`);
                    } else {
                        console.warn(`Pane con id '${firstPinnedPaneId}' non trovato.`);
                    }
                }
            } else {
                console.log("Nessun tab pinnato salvato.");
            }
        } else {
            if (!localStorage) {
                console.warn("localStorage non è supportato.");
            }
            if (!articlesTabs) {
                console.error("Elemento 'articles-tabs' non trovato nel DOM.");
            }
            if (!articlesTabContent) {
                console.error("Elemento 'articles-tab-content' non trovato nel DOM.");
            }
        }
    }

    function saveToHistory(data) {
        if (!historyList) return;
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item';
        listItem.textContent = `${capitalizeFirstLetter(data.act_type || 'N/A')} ${data.act_number || 'N/A'}, Articolo ${data.article || 'N/A'}`;
        historyList.appendChild(listItem);
        console.log('Ricerca salvata nella cronologia:', listItem.textContent);
    }

    function capitalizeFirstLetter(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    function populateBrocardiInfo(brocardiInfo, brocardiInfoDiv) {
        if (!brocardiInfoDiv) return;
        const brocardiContentDiv = brocardiInfoDiv.querySelector('.brocardi-content');
        if (!brocardiContentDiv) return;

        brocardiContentDiv.innerHTML = ''; // Resetta il contenuto

        if (brocardiInfo.Brocardi) {
            if (Array.isArray(brocardiInfo.Brocardi)) {
                brocardiInfo.Brocardi.forEach(brocardo => {
                    brocardiContentDiv.innerHTML += `<p>${brocardo}</p>`;
                });
            } else {
                brocardiContentDiv.innerHTML += `<p>${brocardiInfo.Brocardi}</p>`;
            }
        }

        if (brocardiInfo.Ratio) {
            brocardiContentDiv.innerHTML += `<p><strong>Ratio:</strong> ${brocardiInfo.Ratio}</p>`;
        }

        if (brocardiInfo.Spiegazione) {
            brocardiContentDiv.innerHTML += `<p><strong>Spiegazione:</strong> ${brocardiInfo.Spiegazione}</p>`;
        }

        if (brocardiInfo.Massime && brocardiInfo.Massime.length > 0) {
            brocardiContentDiv.innerHTML += `<h6>Massime:</h6>`;
            brocardiInfo.Massime.forEach(massima => {
                brocardiContentDiv.innerHTML += `<p>${massima}</p>`;
            });
        }

        if (brocardiInfo.link) {
            brocardiContentDiv.innerHTML += `<p><strong>Link:</strong> <a href="${brocardiInfo.link}" target="_blank">${brocardiInfo.link}</a></p>`;
        }
        console.log('Informazioni Brocardi popolate.');
    }

    // ============================
    // Funzioni Principali
    // ============================
    function toggleActDetails() {
        if (!actTypeSelect || !actNumberInput || !dateInput) return;
        const selectedActType = actTypeSelect.value;

        if (actTypesRequiringDetails.includes(selectedActType)) {
            actNumberInput.disabled = false;
            actNumberInput.required = true;
            dateInput.disabled = false;
            dateInput.required = true;
            actNumberInput.classList.remove('disabled');
            dateInput.classList.remove('disabled');
            console.log(`Campi 'Numero Atto' e 'Data' abilitati per tipo atto: ${selectedActType}`);
        } else {
            actNumberInput.disabled = true;
            actNumberInput.required = false;
            actNumberInput.value = '';
            dateInput.disabled = true;
            dateInput.required = false;
            dateInput.value = '';
            actNumberInput.classList.add('disabled');
            dateInput.classList.add('disabled');
            console.log(`Campi 'Numero Atto' e 'Data' disabilitati per tipo atto: ${selectedActType}`);
        }
    }

    function toggleVersionDate() {
        if (!versionRadios || !versionDateInput) return;
        const selectedVersion = document.querySelector('input[name="version"]:checked')?.value;

        if (selectedVersion === 'originale') {
            versionDateInput.disabled = true;
            versionDateInput.value = '';
            versionDateInput.classList.add('disabled');
            console.log("Campo 'Data versione' disabilitato.");
        } else {
            versionDateInput.disabled = false;
            versionDateInput.classList.remove('disabled');
            console.log("Campo 'Data versione' abilitato.");
        }
    }

    function createArticleTab(result, isPinned = false) {
        if (!result.norma_data) {
            console.warn('Dati della norma mancanti:', result);
            return;
        }

        const articleId = result.norma_data.numero_articolo || 'unknown';
        const actType = result.norma_data.tipo_atto || 'unknown';
        const articleTabId = `article-${actType}-${articleId}`;
        const key = `article-${actType}-${articleId}`;

        // Evita di duplicare i tab già presenti
        if (document.getElementById(`${articleTabId}-tab`)) {
            console.log(`Tab già presente: ${articleTabId}-tab`);
            return;
        }

        // Clona il template per il tab articolo
        const template = document.getElementById('article-tab-template');
        if (!template) {
            console.error("Template 'article-tab-template' non trovato.");
            return;
        }
        const tabItem = template.content.cloneNode(true);
        const navLink = tabItem.querySelector('.nav-link');
        navLink.id = `${articleTabId}-tab`;
        navLink.href = `#${articleTabId}`;
        navLink.textContent = `Articolo ${articleId} (${capitalizeFirstLetter(actType)})`;

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
        if (articlesTabs) {
            articlesTabs.appendChild(tabItem);
            console.log(`Tab aggiunto: ${navLink.textContent}`);
        } else {
            console.error("Elemento 'articles-tabs' non trovato nel DOM.");
            return;
        }

        // Clona il template per il contenuto del tab articolo
        const paneTemplate = document.getElementById('article-tab-pane-template');
        if (!paneTemplate) {
            console.error("Template 'article-tab-pane-template' non trovato.");
            return;
        }
        const tabPane = paneTemplate.content.cloneNode(true);
        const paneDiv = tabPane.querySelector('.tab-pane');
        paneDiv.id = articleTabId;
        paneDiv.role = 'tabpanel';
        paneDiv.querySelector('pre').textContent = result.article_text || 'N/A';

        // Aggiungi le informazioni Brocardi se disponibili
        if (isPinned || (result.brocardi_info && result.brocardi_info.position !== 'Not Available')) {
            const brocardiInfoDiv = paneDiv.querySelector('.brocardi-info');
            if (brocardiInfoDiv && result.brocardi_info) {
                brocardiInfoDiv.style.display = 'block';
                populateBrocardiInfo(result.brocardi_info, brocardiInfoDiv);
                console.log(`Informazioni Brocardi aggiunte per: ${articleTabId}`);
            }
        }

        // Aggiungi il contenuto del tab
        if (articlesTabContent) {
            articlesTabContent.appendChild(tabPane);
            console.log(`Pane aggiunto: ${paneDiv.id}`);
        } else {
            console.error("Elemento 'articles-tab-content' non trovato nel DOM.");
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
                console.log(`Tab ${key} unpinned.`);
            } else {
                // Pin
                pinnedTabs[key] = result;
                pinButton.textContent = '📌';
                navLink.classList.add('pinned');
                console.log(`Tab ${key} pinned.`);
            }
            savePinnedTabs();
        });

        // Pulsante di chiusura
        closeButton.addEventListener('click', () => {
            // Rimuovi il tab e il contenuto
            const tabElement = closeButton.closest('li');
            if (!tabElement) return;
            const paneId = navLink.getAttribute('href');
            const paneElement = articlesTabContent.querySelector(paneId);

            if (tabElement) {
                tabElement.remove();
                console.log(`Tab rimosso: ${paneId}`);
            }
            if (paneElement) {
                paneElement.remove();
                console.log(`Pane rimosso: ${paneId}`);
            }

            // Rimuovi dal pinnedTabs se presente
            if (pinnedTabs[key]) {
                delete pinnedTabs[key];
                savePinnedTabs();
                console.log(`Tab ${key} rimosso dai pinnati.`);
            }

            // Attiva il primo tab rimasto
            const remainingTab = articlesTabs.querySelector('.nav-link:not(.pinned)');
            if (remainingTab) {
                remainingTab.classList.add('active');
                const remainingPaneId = remainingTab.getAttribute('href');
                const remainingPane = articlesTabContent.querySelector(remainingPaneId);
                if (remainingPane) {
                    remainingPane.classList.add('show', 'active');
                    console.log(`Pane attivato: ${remainingPaneId}`);
                }
            } else {
                if (articlesContainer) {
                    articlesContainer.style.display = 'none';
                    console.log('Nessun tab rimasto. Contenitore articoli nascosto.');
                }
            }
        });
    }

    function displayResults(results, showBrocardi) {
        // Mostra il contenitore degli articoli
        if (articlesContainer) {
            articlesContainer.style.display = 'block';
            console.log('Contenitore articoli mostrato.');
        }

        // Pulisci i contenuti precedenti
        if (normaDataContainer) normaDataContainer.innerHTML = '';
        if (articlesTabs) articlesTabs.innerHTML = '';
        if (articlesTabContent) articlesTabContent.innerHTML = '';
        console.log('Contenuti precedenti puliti.');

        // Aggiungi i tab pinnati
        for (const key in pinnedTabs) {
            const result = pinnedTabs[key];
            createArticleTab(result, true);
        }

        // Itera sui risultati e crea tab per ogni articolo
        results.forEach((result, index) => {
            if (result.norma_data) {
                // Aggiorna le informazioni sulla norma solo una volta
                if (index === 0 && normaDataContainer) {
                    const normaInfo = `
                        <div><strong>Tipo Atto:</strong> ${capitalizeFirstLetter(result.norma_data.tipo_atto) || 'N/A'}</div>
                        <div><strong>Numero Atto:</strong> ${result.norma_data.numero_atto || 'N/A'}</div>
                        <div><strong>Data:</strong> ${result.norma_data.data || 'N/A'}</div>
                    `;
                    normaDataContainer.innerHTML = normaInfo;
                    console.log('Informazioni sulla norma aggiornate.');
                }

                // Crea un tab per l'articolo
                createArticleTab(result, showBrocardi);
            } else {
                console.warn('Dati della norma mancanti nel risultato:', result);
            }
        });

        // Attiva il primo tab non pinnato se presente
        const firstArticleTab = articlesTabs ? articlesTabs.querySelector('.nav-link:not(.pinned)') : null;
        if (firstArticleTab) {
            firstArticleTab.classList.add('active');
            const paneId = firstArticleTab.getAttribute('href');
            const firstArticleTabPane = articlesTabContent ? articlesTabContent.querySelector(paneId) : null;
            if (firstArticleTabPane) {
                firstArticleTabPane.classList.add('show', 'active');
                console.log(`Pane attivato: ${paneId}`);
            }
        }
    }

    // ============================
    // Event Listeners
    // ============================

    // Event Listener per il Cambio del Tipo di Atto
    const actTypeSelect = document.getElementById('act_type');
    const actNumberInput = document.getElementById('act_number');
    const dateInput = document.getElementById('date');
    if (actTypeSelect) {
        actTypeSelect.addEventListener('change', toggleActDetails);
        console.log("Event listener aggiunto per 'act_type'.");
    } else {
        console.error("Elemento 'act_type' non trovato nel DOM.");
    }

    // Event Listeners per il Cambio della Versione
    const versionRadios = document.querySelectorAll('input[name="version"]');
    const versionDateInput = document.getElementById('version_date');
    if (versionRadios.length > 0) {
        versionRadios.forEach(radio => {
            radio.addEventListener('change', toggleVersionDate);
        });
        console.log("Event listener aggiunti per 'version'.");
    } else {
        console.error("Elementi 'version' non trovati nel DOM.");
    }

    // Event Listener per l'Invio del Form
    if (scrapeForm) {
        scrapeForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            hideError();
            console.log("Form inviato.");

            if (!scrapeForm.checkValidity()) {
                event.stopPropagation();
                scrapeForm.classList.add('was-validated');
                console.log("Form non valido.");
                return;
            }

            scrapeForm.classList.remove('was-validated');
            console.log("Form validato.");

            // Pulisci i contenuti precedenti
            if (normaDataContainer) normaDataContainer.innerHTML = '';
            if (articlesContainer) articlesContainer.style.display = 'none';
            if (articlesTabs) articlesTabs.innerHTML = '';
            if (articlesTabContent) articlesTabContent.innerHTML = '';
            console.log("Contenuti precedenti puliti.");

            // Mostra il loading indicator
            if (loadingIndicator) {
                loadingIndicator.style.display = 'block';
                console.log('Loading indicator mostrato.');
            }

            // Raccogli i dati del form
            const formData = new FormData(scrapeForm);
            const data = Object.fromEntries(formData.entries());
            data.article = document.getElementById('article').value;
            data.show_brocardi_info = formData.has('show_brocardi_info');
            console.log('Dati raccolti dal form:', data);

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
                    console.log('Risultati fetch_all_data:', results);
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
                    console.log('Risultati combinati:', results);
                }

                if (!results || results.length === 0) {
                    throw new Error('Nessun risultato trovato.');
                }

                // Visualizza i risultati
                displayResults(results, data.show_brocardi_info);
                console.log('Risultati visualizzati.');

                // Salva nella cronologia
                saveToHistory(data);
            } catch (error) {
                showError(error.message || 'Si è verificato un errore. Riprova più tardi.');
                console.error('Errore:', error);
            } finally {
                // Nascondi il loading indicator
                if (loadingIndicator) {
                    loadingIndicator.style.display = 'none';
                    console.log('Loading indicator nascosto.');
                }
            }
        });
        console.log("Event listener aggiunto per l'invio del form.");
    } else {
        console.error("Elemento 'scrape-form' non trovato nel DOM.");
    }

    // Event Listener per i Pulsanti di Incremento e Decremento
    const incrementButton = document.querySelector('.increment');
    const decrementButton = document.querySelector('.decrement');
    const articleInput = document.getElementById('article');

    if (incrementButton && articleInput) {
        incrementButton.addEventListener('click', () => {
            const currentValue = parseInt(articleInput.value, 10);
            articleInput.value = isNaN(currentValue) ? 1 : currentValue + 1;
            console.log(`Articolo incrementato a: ${articleInput.value}`);
        });
        console.log("Event listener aggiunto per il pulsante di incremento.");
    } else {
        if (!incrementButton) {
            console.error("Pulsante di incremento non trovato nel DOM.");
        }
        if (!articleInput) {
            console.error("Campo 'article' non trovato nel DOM.");
        }
    }

    if (decrementButton && articleInput) {
        decrementButton.addEventListener('click', () => {
            const currentValue = parseInt(articleInput.value, 10);
            if (!isNaN(currentValue) && currentValue > 1) {
                articleInput.value = currentValue - 1;
                console.log(`Articolo decrementato a: ${articleInput.value}`);
            }
        });
        console.log("Event listener aggiunto per il pulsante di decremento.");
    } else {
        if (!decrementButton) {
            console.error("Pulsante di decremento non trovato nel DOM.");
        }
        if (!articleInput) {
            console.error("Campo 'article' non trovato nel DOM.");
        }
    }

    // Event Listener per il Pulsante di Reset del Form
    if (resetButton) {
        resetButton.addEventListener('click', () => {
            if (scrapeForm) {
                scrapeForm.reset();
                scrapeForm.classList.remove('was-validated');
                console.log('Form resettato.');
            }
            if (normaDataContainer) normaDataContainer.innerHTML = '';
            if (articlesContainer) {
                articlesContainer.style.display = 'none';
                console.log('Contenitore articoli nascosto.');
            }
            if (articlesTabs) articlesTabs.innerHTML = '';
            if (articlesTabContent) articlesTabContent.innerHTML = '';
            toggleActDetails();
            toggleVersionDate();
            console.log('Form resettato e campi aggiornati.');
        });
        console.log("Event listener aggiunto per il pulsante di reset del form.");
    } else {
        console.error("Elemento 'reset-button' non trovato nel DOM.");
    }

    // Event Listener per il Pulsante di Cancellazione dei Campi di Ricerca
    if (clearSearchFieldsButton) {
        clearSearchFieldsButton.addEventListener('click', () => {
            if (scrapeForm) {
                scrapeForm.reset();
                scrapeForm.classList.remove('was-validated');
                console.log('Campi di ricerca cancellati.');
            }
            toggleActDetails();
            toggleVersionDate();
            console.log('Campi di ricerca cancellati e campi aggiornati.');
        });
        console.log("Event listener aggiunto per il pulsante di cancellazione dei campi di ricerca.");
    } else {
        console.error("Elemento 'clear-search-fields' non trovato nel DOM.");
    }

    // Event Listener per il Pulsante di Reset della Cronologia
    if (resetHistoryButton) {
        resetHistoryButton.addEventListener('click', () => {
            if (historyList) {
                historyList.innerHTML = '';
                console.log('Cronologia resettata.');
            }
        });
        console.log("Event listener aggiunto per il pulsante di reset della cronologia.");
    } else {
        console.error("Elemento 'reset-history' non trovato nel DOM.");
    }

    // Event Listener per la Ricerca nella Cronologia con Debounce
    if (historySearchInput) {
        historySearchInput.addEventListener('input', debounce(() => {
            const query = historySearchInput.value.toLowerCase();
            const listItems = historyList.querySelectorAll('li');

            listItems.forEach(item => {
                const text = item.textContent.toLowerCase();
                if (text.includes(query)) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            });

            console.log(`Filtrata la cronologia con la query: ${query}`);
        }, 300));
        console.log("Event listener aggiunto per la ricerca nella cronologia.");
    } else {
        console.error("Elemento 'history-search' non trovato nel DOM.");
    }

    // ============================
    // Inizializzazione
    // ============================
    toggleActDetails();
    toggleVersionDate();
    loadPinnedTabs();
    console.log('Inizializzazione completata.');
});
