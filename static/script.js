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

    // Aggiungi il pulsante "Copia"
    const copyButton = `<button id="copy-button" class="btn btn-primary mb-2">Copia Testo</button>`;
    
    // Usa <pre> per mantenere la formattazione originale del testo
    const articleContent = `<pre id="article-text" style="white-space: pre-wrap; word-wrap: break-word;">${articleText}</pre>`;
    
    resultContainer.innerHTML = copyButton + articleContent;

    // Aggiungi l'evento di copia al pulsante
    document.getElementById('copy-button').addEventListener('click', function() {
        copyToClipboard();
    });
}


/*******************************
 * FUNZIONE PER LA COPIA NEGLI APPUNTI
 *******************************/
function copyToClipboard() {
    const articleText = document.getElementById('article-text').innerText;

    // Verifica se l'API clipboard è supportata
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(articleText).then(() => {
            alert("Testo copiato negli appunti!");
        }).catch(err => {
            console.error("Errore nella copia del testo: ", err);
            alert("Errore nella copia del testo.");
        });
    } else {
        // Fallback per browser che non supportano navigator.clipboard
        fallbackCopyText(articleText);
    }
}

/*******************************
 * FALLBACK PER LA COPIA MANUALE DEL TESTO
 *******************************/
function fallbackCopyText(text) {
    // Crea un elemento textarea temporaneo
    const textarea = document.createElement('textarea');
    textarea.value = text;

    // Aggiungi il textarea alla pagina (non visibile all'utente)
    document.body.appendChild(textarea);

    // Seleziona il testo nel textarea
    textarea.select();
    textarea.setSelectionRange(0, 99999); // Per dispositivi mobili

    // Copia il testo selezionato
    try {
        document.execCommand('copy');
        alert("Testo copiato negli appunti!");
    } catch (err) {
        console.error("Errore durante la copia del testo con execCommand: ", err);
        alert("Errore nella copia del testo.");
    }

    // Rimuovi il textarea temporaneo
    document.body.removeChild(textarea);
}

/*******************************
 * VISUALIZZAZIONE INFORMAZIONI BROCARDI
 *******************************/
function displayBrocardiInfo(brocardiInfo) {
    const brocardiInfoContainer = document.getElementById('brocardi-info-container');
    const brocardiTabs = document.getElementById('brocardi-tabs');
    const brocardiTabContent = document.getElementById('brocardi-tab-content');

    // Svuota contenuto precedente
    brocardiTabs.innerHTML = '';
    brocardiTabContent.innerHTML = '';

    if (!brocardiInfo || !brocardiInfo.position) {
        // Nascondi il pulsante e la sezione Brocardi se non esiste una posizione
        brocardiInfoContainer.style.display = 'none';
        return;
    }

    const { position, info, link } = brocardiInfo;
    let hasContent = false;

    // Tab per Posizione e Link
    if (position) {
        brocardiTabs.innerHTML += `
            <li class="nav-item">
                <a class="nav-link active" id="tab-posizione" data-bs-toggle="tab" href="#posizione" role="tab">Posizione</a>
            </li>`;
        brocardiTabContent.innerHTML += `
            <div class="tab-pane fade show active" id="posizione" role="tabpanel">
                <p><strong>Posizione:</strong> ${position}</p>
                <p><strong>Link:</strong> <a href="${link}" target="_blank">${link}</a></p>
            </div>`;
        hasContent = true;
    }

    // Tab per Brocardi
    if (info.Brocardi && info.Brocardi.length > 0) {
        brocardiTabs.innerHTML += `
            <li class="nav-item">
                <a class="nav-link" id="tab-brocardi" data-bs-toggle="tab" href="#brocardi" role="tab">Brocardi</a>
            </li>`;
        brocardiTabContent.innerHTML += `
            <div class="tab-pane fade" id="brocardi" role="tabpanel">
                <ul>${info.Brocardi.map(text => `<li>${text}</li>`).join('')}</ul>
            </div>`;
        hasContent = true;
    }

    // Tab per Ratio
    if (info.Ratio) {
        brocardiTabs.innerHTML += `
            <li class="nav-item">
                <a class="nav-link" id="tab-ratio" data-bs-toggle="tab" href="#ratio" role="tab">Ratio</a>
            </li>`;
        brocardiTabContent.innerHTML += `
            <div class="tab-pane fade scrollable" id="ratio" role="tabpanel">
                <p>${info.Ratio}</p>
            </div>`;
        hasContent = true;
    }

    // Tab per Spiegazione
    if (info.Spiegazione) {
        brocardiTabs.innerHTML += `
            <li class="nav-item">
                <a class="nav-link" id="tab-spiegazione" data-bs-toggle="tab" href="#spiegazione" role="tab">Spiegazione</a>
            </li>`;
        brocardiTabContent.innerHTML += `
            <div class="tab-pane fade scrollable" id="spiegazione" role="tabpanel">
                <p>${info.Spiegazione}</p>
            </div>`;
        hasContent = true;
    }

    // Tab per Massime, ogni massima ha una scrollbar separata
    if (info.Massime && info.Massime.length > 0) {
        const validMassime = info.Massime.filter(text => text && text.trim() !== ''); // Filtra solo massime con contenuto
        if (validMassime.length > 0) {
            brocardiTabs.innerHTML += `
                <li class="nav-item">
                    <a class="nav-link" id="tab-massime" data-bs-toggle="tab" href="#massime" role="tab">Massime</a>
                </li>`;
            brocardiTabContent.innerHTML += `
                <div class="tab-pane fade" id="massime" role="tabpanel">
                    ${validMassime.map((text, index) => `
                        <div class="massima-item">
                            <h5>Massima ${index + 1}</h5>
                            <div class="scrollable-content">${text}</div>
                        </div>
                    `).join('')}
                </div>`;
            hasContent = true;
        }
    }

    // Mostra la sezione Brocardi se ha contenuto
    if (hasContent) {
        brocardiInfoContainer.style.display = 'block';
    } else {
        brocardiInfoContainer.style.display = 'none';
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
