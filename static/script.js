document.addEventListener('DOMContentLoaded', () => {
    // Riferimenti agli elementi del DOM
    const scrapeForm = document.getElementById('scrape-form');
    const normaDataContainer = document.getElementById('norma-data');
    const resultContainer = document.getElementById('result');
    const brocardiInfoContainer = document.getElementById('brocardi-info-container');
    const brocardiTabs = document.getElementById('brocardi-tabs');
    const brocardiTabContent = document.getElementById('brocardi-tab-content');
    const loadingIndicator = document.getElementById('loading');
    const historyList = document.getElementById('history-list');
    const resetHistoryButton = document.getElementById('reset-history');
    const resetButton = document.getElementById('reset-button');

    // Definisci i tipi di atto che richiedono 'Numero Atto' e 'Data'
    const actTypesRequiringDetails = [
        'legge',
        'decreto legge',
        'decreto legislativo',
        'Regolamento UE',
        'Direttiva UE'
    ];

    // Riferimenti agli elementi del DOM
    const actTypeSelect = document.getElementById('act_type');
    const actNumberInput = document.getElementById('act_number');
    const dateInput = document.getElementById('date');

    // Funzione per abilitare/disabilitare i campi 'Numero Atto' e 'Data'
    function toggleActDetails() {
        const selectedActType = actTypeSelect.value;

        if (actTypesRequiringDetails.includes(selectedActType)) {
            actNumberInput.disabled = false;
            actNumberInput.required = true;
            dateInput.disabled = false;
            dateInput.required = true;
            actNumberInput.classList.remove('disabled');
            dateInput.classList.remove('disabled');
        } else {
            actNumberInput.disabled = true;
            actNumberInput.required = false;
            actNumberInput.value = '';
            dateInput.disabled = true;
            dateInput.required = false;
            dateInput.value = '';
            actNumberInput.classList.add('disabled');
            dateInput.classList.add('disabled');
        }
    }

    // Aggiungi event listener per il 'Tipo Atto'
    actTypeSelect.addEventListener('change', toggleActDetails);
    toggleActDetails();

    // Riferimenti ai radio-buttons e al campo 'Data Versione'
    const versionRadios = document.querySelectorAll('input[name="version"]');
    const versionDateInput = document.getElementById('version_date');

    // Funzione per abilitare/disabilitare 'Data Versione'
    function toggleVersionDate() {
        const selectedVersion = document.querySelector('input[name="version"]:checked').value;

        if (selectedVersion === 'originale') {
            versionDateInput.disabled = true;
            versionDateInput.value = '';
            versionDateInput.classList.add('disabled');
        } else {
            versionDateInput.disabled = false;
            versionDateInput.classList.remove('disabled');
        }
    }

    // Aggiungi event listeners ai radio-buttons
    versionRadios.forEach(radio => {
        radio.addEventListener('change', toggleVersionDate);
    });
    toggleVersionDate();

    // Validazione del form
    (function () {
        'use strict';
        const forms = document.querySelectorAll('.needs-validation');

        Array.from(forms).forEach(function (form) {
            form.addEventListener('submit', function (event) {
                if (!form.checkValidity()) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                form.classList.add('was-validated');
            }, false);
        });
    })();

    // Event listener per l'invio del form
    scrapeForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (!scrapeForm.checkValidity()) {
            event.stopPropagation();
            scrapeForm.classList.add('was-validated');
            return;
        }

        scrapeForm.classList.remove('was-validated');
        normaDataContainer.innerHTML = '';
        resultContainer.innerHTML = '';
        brocardiInfoContainer.style.display = 'none';
        brocardiTabs.innerHTML = '';
        brocardiTabContent.innerHTML = '';
        loadingIndicator.style.display = 'block';

        const formData = new FormData(scrapeForm);
        const data = Object.fromEntries(formData.entries());
        data.article = document.getElementById('article').value;
        data.show_brocardi_info = formData.has('show_brocardi_info');

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
            }

            if (results.length === 0) {
                throw new Error('Nessun risultato trovato.');
            }

            displayResults(results, data.show_brocardi_info);
            saveToHistory(data);
        } catch (error) {
            console.error('Errore:', error);
            alert('Si è verificato un errore durante l\'estrazione dei dati.');
        } finally {
            loadingIndicator.style.display = 'none';
        }
    });

    // Event listeners per incrementare e decrementare il numero di articolo
    document.querySelector('.increment').addEventListener('click', () => {
        const articleInput = document.getElementById('article');
        articleInput.value = parseInt(articleInput.value) + 1;
    });

    document.querySelector('.decrement').addEventListener('click', () => {
        const articleInput = document.getElementById('article');
        if (parseInt(articleInput.value) > 1) {
            articleInput.value = parseInt(articleInput.value) - 1;
        }
    });

    // Reset del form
    resetButton.addEventListener('click', () => {
        scrapeForm.reset();
        scrapeForm.classList.remove('was-validated');
        normaDataContainer.innerHTML = '';
        resultContainer.innerHTML = '';
        brocardiInfoContainer.style.display = 'none';
        brocardiTabs.innerHTML = '';
        brocardiTabContent.innerHTML = '';
        toggleActDetails();
        toggleVersionDate();
    });

    // Funzione per visualizzare i risultati
    function displayResults(results, showBrocardi) {
        results.forEach(result => {
            if (result.norma_data) {
                const normaInfo = `
                    <div><strong>Tipo Atto:</strong> ${result.norma_data.tipo_atto || 'N/A'}</div>
                    <div><strong>Numero Atto:</strong> ${result.norma_data.numero_atto || 'N/A'}</div>
                    <div><strong>Data:</strong> ${result.norma_data.data || 'N/A'}</div>
                    <div><strong>Articolo:</strong> ${result.norma_data.numero_articolo || 'N/A'}</div>
                `;
                normaDataContainer.innerHTML = normaInfo;

                if (result.article_text) {
                    resultContainer.innerHTML = `<div><strong>Testo Articolo:</strong><pre>${result.article_text || 'N/A'}</pre></div>`;
                }

                if (showBrocardi && result.brocardi_info && result.brocardi_info.position !== 'Not Available') {
                    brocardiInfoContainer.style.display = 'block';
                    const tabId = `brocardi-${result.norma_data.numero_articolo || 'N/A'}`;

                    // Crea tab item
                    const tabItem = document.createElement('li');
                    tabItem.className = 'nav-item';
                    tabItem.innerHTML = `<a class="nav-link" id="${tabId}-tab" data-bs-toggle="tab" href="#${tabId}" role="tab">${result.norma_data.numero_articolo || 'N/A'}</a>`;
                    brocardiTabs.appendChild(tabItem);

                    // Crea tab pane
                    const tabPane = document.createElement('div');
                    tabPane.className = 'tab-pane fade';
                    tabPane.id = tabId;
                    tabPane.role = 'tabpanel';

                    // Popola il tab pane con le informazioni Brocardi
                    let brocardiContent = '';
                    if (result.brocardi_info.Brocardi) {
                        brocardiContent += `<div><strong>Brocardi:</strong> ${result.brocardi_info.Brocardi}</div>`;
                    }
                    if (result.brocardi_info.Ratio) {
                        brocardiContent += `<div><strong>Ratio:</strong> ${result.brocardi_info.Ratio}</div>`;
                    }
                    if (result.brocardi_info.Spiegazione) {
                        brocardiContent += `<div><strong>Spiegazione:</strong> ${result.brocardi_info.Spiegazione}</div>`;
                    }
                    if (result.brocardi_info.Massime) {
                        brocardiContent += `<div><strong>Massime:</strong><ul>`;
                        result.brocardi_info.Massime.forEach(massima => {
                            brocardiContent += `<li>${massima}</li>`;
                        });
                        brocardiContent += `</ul></div>`;
                    }
                    if (result.brocardi_info.link) {
                        brocardiContent += `<div><strong>Link:</strong> <a href="${result.brocardi_info.link}" target="_blank">${result.brocardi_info.link}</a></div>`;
                    }

                    tabPane.innerHTML = brocardiContent;
                    brocardiTabContent.appendChild(tabPane);
                }
            } else {
                console.warn('Dati della norma mancanti nel risultato:', result);
            }
        });

        // Attiva il primo tab se esiste
        const firstTab = brocardiTabs.querySelector('.nav-link');
        if (firstTab) {
            firstTab.classList.add('active');
            const firstTabPane = brocardiTabContent.querySelector('.tab-pane');
            if (firstTabPane) {
                firstTabPane.classList.add('show', 'active');
            }
        }
    }

    // Funzione per salvare nella cronologia
    function saveToHistory(data) {
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item';
        listItem.textContent = `${data.act_type || 'N/A'} ${data.act_number || 'N/A'}, Articolo ${data.article || 'N/A'}`;
        historyList.appendChild(listItem);
    }

    // Reset della cronologia
    resetHistoryButton.addEventListener('click', () => {
        historyList.innerHTML = '';
    });
});
