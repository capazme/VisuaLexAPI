document.addEventListener('DOMContentLoaded', () => {
    const scrapeForm = document.getElementById('scrape-form');
    const normaDataContainer = document.getElementById('norma-data');
    const resultContainer = document.getElementById('result');
    const brocardiInfoContainer = document.getElementById('brocardi-info-container');
    const brocardiTabs = document.getElementById('brocardi-tabs');
    const brocardiTabContent = document.getElementById('brocardi-tab-content');
    const loadingIndicator = document.getElementById('loading');
    const historyList = document.getElementById('history-list');
    const resetHistoryButton = document.getElementById('reset-history');

    // Event listener for form submission
    scrapeForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        normaDataContainer.innerHTML = '';
        resultContainer.innerHTML = '';
        brocardiInfoContainer.style.display = 'none';
        loadingIndicator.style.display = 'block';

        const formData = new FormData(scrapeForm);
        const data = Object.fromEntries(formData.entries());
        data.article = document.getElementById('article').value;
        data.show_brocardi_info = formData.has('show_brocardi_info');

        console.log('Form data:', data);

        try {
            const response = await fetch('/fetch_all_data', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            console.log('Server response status:', response.status);

            if (!response.ok) {
                throw new Error('Errore durante la richiesta al server.');
            }

            const results = await response.json();
            console.log('Server response data:', results);

            if (results.length === 0) {
                throw new Error('Nessun risultato trovato.');
            }
            displayResults(results);
            saveToHistory(data);
        } catch (error) {
            console.error('Errore:', error);
            alert('Si è verificato un errore durante l\'estrazione dei dati.');
        } finally {
            loadingIndicator.style.display = 'none';
        }
    });

    // Event listeners for increment and decrement buttons
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

    // Display results in the UI
    function displayResults(results) {
        console.log('Displaying results:', results);
        results.forEach(result => {
            if (result.norma_data) {
                console.log('Norma data:', result.norma_data);
                normaDataContainer.innerHTML += `<div><strong>Norma:</strong> ${result.norma_data.tipo_atto || 'N/A'} ${result.norma_data.numero_atto || 'N/A'} del ${result.norma_data.data || 'N/A'}</div>`;
                resultContainer.innerHTML += `<div><strong>Testo Articolo:</strong> ${result.article_text || 'N/A'}</div>`;

                if (result.brocardi_info && result.brocardi_info.position !== 'Not Available') {
                    console.log('Brocardi info:', result.brocardi_info);
                    brocardiInfoContainer.style.display = 'block';
                    const tabId = `brocardi-${result.norma_data.numero_atto || 'N/A'}`;
                    brocardiTabs.innerHTML += `<li class="nav-item"><a class="nav-link" id="${tabId}-tab" data-bs-toggle="tab" href="#${tabId}" role="tab">Articolo ${result.norma_data.numero_atto || 'N/A'}</a></li>`;
                    brocardiTabContent.innerHTML += `<div class="tab-pane fade" id="${tabId}" role="tabpanel">${result.brocardi_info.info || 'N/A'}</div>`;
                }
            } else {
                console.warn('Missing norma_data in result:', result);
            }
        });
    }

    // Save to history
    function saveToHistory(data) {
        console.log('Saving to history:', data);
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item';
        listItem.textContent = `${data.act_type || 'N/A'} ${data.act_number || 'N/A'}, Articolo ${data.article || 'N/A'}`;
        historyList.appendChild(listItem);
    }

    // Reset history
    resetHistoryButton.addEventListener('click', () => {
        console.log('Resetting history');
        historyList.innerHTML = '';
    });
});