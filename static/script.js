/*******************************
 * GESTIONE DELLA SOTTOMISSIONE DEL FORM
 *******************************/
document.getElementById('scrape-form').addEventListener('submit', async function(e) {
    e.preventDefault();

    resetUI(); // Resetta l'interfaccia prima di fare la richiesta

    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());

    // Validate the form data
    if (!validateFormData(data)) {
        handleError(new Error('I campi del modulo non sono validi!'), document.getElementById('result'));
        return;
    }

    try {
        setLoading(true); // Inizia il caricamento

        // Fetch dei dati della norma (norma, articolo e brocardi)
        const normaData = await fetchNormaData(data);
        if (!normaData) {
            throw new Error('Errore nel recupero dei dati della norma.');
        }

        // Visualizza i dati della norma
        displayNormaData(normaData.norma_data);

        // Visualizza il risultato dell'articolo
        displayArticleText(normaData.result);

        // Visualizza le informazioni di Brocardi (se presenti)
        displayBrocardiInfo(normaData.brocardi_info);

        // Aggiorna la cronologia
        await updateHistory();

    } catch (error) {
        handleError(error, document.getElementById('result'));
    } finally {
        setLoading(false); // Nascondi il caricamento
    }
});

/*******************************
 * FUNZIONE PER ABILITARE/DISABILITARE CAMPI
 *******************************/
function toggleFieldsBasedOnActType() {
    const actType = document.getElementById('act_type').value;
    const dateField = document.getElementById('date');
    const actNumberField = document.getElementById('act_number');
    
    // Lista dei tipi di atti che richiedono data e numero
    const allowedTypes = ['legge', 'decreto legge', 'decreto legislativo', 'd.p.r.', 'Regolamento UE', 'Direttiva UE'];

    // Abilita o disabilita in base al tipo di atto
    if (allowedTypes.includes(actType)) {
        dateField.disabled = false;
        actNumberField.disabled = false;
    } else {
        dateField.disabled = true;
        actNumberField.disabled = true;
        dateField.value = '';
        actNumberField.value = '';
    }
}

function toggleVersionDate() {
    const versionOriginal = document.getElementById('originale').checked;
    const versionDateField = document.getElementById('version_date');
    
    // Disabilita la data versione se la versione è "originale"
    if (versionOriginal) {
        versionDateField.disabled = true;
        versionDateField.value = '';
    } else {
        versionDateField.disabled = false;
    }
}

/*******************************
 * INIZIALIZZAZIONE DEL FORM
 *******************************/
function initializeForm() {
    // Verifica e imposta correttamente i campi al caricamento della pagina
    toggleFieldsBasedOnActType();
    toggleVersionDate();
    
    // Event listener per il cambiamento del tipo di atto
    document.getElementById('act_type').addEventListener('change', toggleFieldsBasedOnActType);

    // Event listener per il cambiamento della versione (vigente/originale)
    document.querySelectorAll('input[name="version"]').forEach(input => {
        input.addEventListener('change', toggleVersionDate);
    });
}

// Inizializza il form quando la pagina viene caricata
document.addEventListener('DOMContentLoaded', initializeForm);

/*******************************
 * VALIDAZIONE DEI DATI DEL FORM
 *******************************/
function validateFormData(data) {
    if (!data.act_type || !data.article || isNaN(parseInt(data.article))) {
        return false;
    }
    return true;
}

/*******************************
 * FUNZIONE DI FETCH PER L'ENDPOINT /fetch_norm
 *******************************/
async function fetchNormaData(data) {
    try {
        const response = await fetch('/fetch_norm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return await handleApiResponse(response);
    } catch (error) {
        console.error('Errore nella richiesta API:', error);
        throw new Error('Impossibile recuperare i dati dalla API.');
    }
}

/*******************************
 * FUNZIONE DI GESTIONE DELLE RISPOSTE API
 *******************************/
async function handleApiResponse(response) {
    if (!response.ok) {
        const errorResponse = await response.json();
        throw new Error(errorResponse.error || 'Errore nella risposta API');
    }
    return await response.json();
}

/*******************************
 * FUNZIONI DI VISUALIZZAZIONE
 *******************************/
function displayNormaData(normaData) {
    const normaDataContainer = document.getElementById('norma-data');
    let content = `<h2>Informazioni della Norma</h2>`;
    
    // Mostra solo i campi non null o non vuoti
    if (normaData.tipo_atto) {
        content += `<p><strong>Tipo atto:</strong> ${normaData.tipo_atto}</p>`;
    }
    if (normaData.data) {
        content += `<p><strong>Data:</strong> ${normaData.data}</p>`;
    }
    if (normaData.numero_atto) {
        content += `<p><strong>Numero atto:</strong> ${normaData.numero_atto}</p>`;
    }
    if (normaData.numero_articolo) {
        content += `<p><strong>Numero articolo:</strong> ${normaData.numero_articolo}</p>`;
    }
    if (normaData.versione) {
        content += `<p><strong>Versione:</strong> ${normaData.versione}</p>`;
    }
    if (normaData.data_versione) {
        content += `<p><strong>Data versione:</strong> ${normaData.data_versione}</p>`;
    }
    if (normaData.url) {
        content += `<p><strong>URL:</strong> <a href="${normaData.url}" target="_blank">${normaData.url}</a></p>`;
    }
    
    // Inserisci il contenuto nel container
    normaDataContainer.innerHTML = content;
}

function displayArticleText(articleText) {
    const resultContainer = document.getElementById('result');
    
    // Usa <pre> per mantenere la formattazione originale del testo
    resultContainer.innerHTML = `<pre style="white-space: pre-wrap; word-wrap: break-word;">${articleText}</pre>`;
}

/*******************************
 * VISUALIZZAZIONE INFORMAZIONI BROCARDI
 *******************************/
function displayBrocardiInfo(brocardiInfo) {
    const brocardiInfoContainer = document.getElementById('brocardi-info');
    if (!brocardiInfo || !brocardiInfo.info) {
        document.getElementById('brocardi-info-container').style.display = 'none';
        return;
    }

    const { position, info } = brocardiInfo;
    let content = '';

    if (position) {
        content += `<h2>Posizione:</h2><p>${position}</p>`;
    }

    if (info.Brocardi && info.Brocardi.length > 0) {
        content += `<h3>Brocardi:</h3><ul>${info.Brocardi.map(text => `<li>${text}</li>`).join('')}</ul>`;
    }

    if (info.Ratio) {
        content += `<h3>Ratio:</h3><p>${info.Ratio}</p>`;
    }

    if (info.Spiegazione) {
        content += `<h3>Spiegazione:</h3><p>${info.Spiegazione}</p>`;
    }

    if (info.Massime && info.Massime.length > 0) {
        content += `<h3>Massime:</h3><ul>${info.Massime.map(text => `<li>${text}</li>`).join('')}</ul>`;
    }

    if (content) {
        brocardiInfoContainer.innerHTML = content;
        document.getElementById('brocardi-info-container').style.display = 'block';
    } else {
        document.getElementById('brocardi-info-container').style.display = 'none';
    }
}

/*******************************
 * GESTIONE UI E FUNZIONI DI SUPPORTO
 *******************************/
function resetUI() {
    document.getElementById('norma-data').innerHTML = '';
    document.getElementById('result').innerHTML = '';
    document.getElementById('brocardi-info-container').style.display = 'none';
}

function setLoading(isLoading) {
    const loadingElement = document.getElementById('loading');
    const submitButton = document.querySelector('button[type="submit"]');
    submitButton.disabled = isLoading;
    submitButton.textContent = isLoading ? 'Caricamento...' : 'Estrai Dati';
    loadingElement.style.display = isLoading ? 'block' : 'none';
}

function handleError(error, messageContainer) {
    messageContainer.innerHTML = `<p class="error-message text-danger">Errore: ${error.message || error}</p>`;
}

/*******************************
 * GESTIONE DELLA CRONOLOGIA
 *******************************/
async function updateHistory() {
    try {
        const response = await fetch('/history');
        const history = await response.json();
        const historyList = document.getElementById('history-list');
        historyList.innerHTML = history.map(entry => `
            <li class="list-group-item">
                <strong>${entry.tipo_atto}</strong> ${entry.data}, art. ${entry.numero_articolo}
                <a href="${entry.urn}" target="_blank">Link</a>
            </li>
        `).join('');
    } catch (error) {
        console.error('Errore nel recupero della cronologia:', error);
    }
}

// Funzione per resettare la cronologia
document.getElementById('reset-history').addEventListener('click', async () => {
    try {
        await fetch('/clear_history', { method: 'POST' });
        updateHistory(); // Aggiorna la cronologia dopo il reset
    } catch (error) {
        console.error('Errore durante la pulizia della cronologia:', error);
    }
});

/*******************************
 * GESTIONE DELL'INCREMENTO E DECREMENTO ARTICOLO
 *******************************/
document.querySelector('.increment').addEventListener('click', () => {
    let articleInput = document.getElementById('article');
    let currentValue = parseInt(articleInput.value, 10) || 1;
    articleInput.value = currentValue + 1;
});

document.querySelector('.decrement').addEventListener('click', () => {
    let articleInput = document.getElementById('article');
    let currentValue = parseInt(articleInput.value, 10) || 1;
    articleInput.value = Math.max(currentValue - 1, 1); // Mai meno di 1
});
