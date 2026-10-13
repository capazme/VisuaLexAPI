-- Version 1 of the MERL-T notice (INFORMATIVA_MERLT), the text a person reads before choosing a
-- MERL-T consent level. Written by the migration, hence no author; a change is a new version
-- saved from the admin screen, never an edit of this row. In its own migration because Postgres
-- refuses to use an enum value in the transaction that added it.
INSERT INTO "lingo_testi_versioni" ("id", "chiave", "versione", "titolo", "corpo", "conferma", "azione", "autore_id")
VALUES (
    'b530fcb2-f80c-4b32-8940-c9127c55b83c',
    'INFORMATIVA_MERLT',
    1,
    'MERL-T: i dati della tua attività',
    'MERL-T è la parte di VisuaLex che impara da come i giuristi leggono e usano le fonti, per migliorare la ricerca, i collegamenti tra norme e sentenze e le risposte dell''assistente. Per farlo usa dati sulla tua attività. Li raccoglie solo se acconsenti, e puoi cambiare scelta in qualsiasi momento da Impostazioni › Dati MERL-T.

Titolare del trattamento: [titolare]. Per esercitare i tuoi diritti o per qualsiasi domanda: [contatto].

Leggere, cercare e lavorare in VisuaLex non richiede alcun consenso. Se scegli «Nessuna raccolta», MERL-T non riceve nulla della tua attività, e tutto il resto funziona come prima.

Livello «Base». Raccogliamo, legati al tuo account:
– gli articoli che apri, per quanto tempo restano a schermo e fin dove li scorri;
– le evidenziazioni: il testo evidenziato (fino a 2.000 caratteri), la posizione e il colore;
– le note sul testo: il passo a cui sono ancorate e il testo integrale della nota (fino a 5.000 caratteri);
– i segnalibri e gli articoli che aggiungi a un dossier, con le etichette che scegli e l''identificativo del dossier;
– le citazioni che apri dall''anteprima, con il testo della citazione;
– nel Forum, i «mi piace», gli ambienti che scarichi e le proposte che accetti o rifiuti (l''ambiente, mai chi lo ha scritto);
– le domande che fai all''assistente e le risposte che ricevi.
A ogni dato si aggiungono il tuo identificativo VisuaLex e il livello di autorevolezza e la qualifica che MERL-T ti attribuisce.

Livello «Completo». In più raccogliamo:
– i giudizi e i commenti che dai alle risposte dell''assistente e alle fonti che cita;
– quando apri una citazione dall''anteprima, il testo della citazione riconosciuta e circa 1.000 caratteri dell''articolo intorno a essa, inviati in automatico per insegnare a MERL-T a riconoscere le citazioni; e le conferme, correzioni e segnalazioni che fai sulle citazioni;
– i documenti che carichi, le entità e le relazioni che proponi per il grafo e i voti che dai alle proposte degli altri.

Perché e su quale base. Trattiamo questi dati solo con il tuo consenso (art. 6, par. 1, lett. a, del Regolamento UE 2016/679), per migliorare il servizio e per studiarne il funzionamento. L''autorevolezza serve solo a pesare i tuoi contributi nell''apprendimento di MERL-T: non produce alcun effetto su di te. Quando i dati escono da VisuaLex per la ricerca, il tuo identificativo è sostituito da un codice e i testi sono tolti.

Chi li vede. I dati restano sui server di VisuaLex. Le domande che fai all''assistente, con i testi necessari a rispondere, sono elaborate da modelli linguistici di fornitori esterni, tramite il servizio OpenRouter [paese e garanzie: domanda 6]. Non vendiamo né cediamo i dati a nessuno.

Per quanto tempo. Gli eventi di attività (letture, evidenziazioni, note, segnalibri, citazioni, Forum) sono cancellati in automatico dopo [12 mesi]. Le domande all''assistente, i giudizi e le segnalazioni sulle citazioni [dopo 24 mesi]. Gli eventi che non è stato possibile consegnare a MERL-T restano in un registro di emergenza al massimo [7 giorni], senza alcun testo. Quando elimini i dati o l''account, li cancelliamo tutti subito. [Contributi al grafo approvati dalla comunità: restano, senza più alcun legame con te — domanda 4.]

I tuoi diritti. Da Impostazioni › Dati MERL-T puoi in ogni momento:
– scaricare una copia dei tuoi dati (accesso e portabilità);
– eliminarli («Elimina i miei dati MERL-T»); eliminando l''account si eliminano anche questi;
– cambiare livello o revocare il consenso. La revoca vale per il futuro: ti chiediamo se eliminare anche quanto raccolto fino a quel momento.
Per la rettifica, la limitazione, l''opposizione o qualsiasi altra richiesta scrivi a [contatto]. Hai anche il diritto di proporre reclamo al Garante per la protezione dei dati personali (www.garanteprivacy.it).',
    'Ho letto l''informativa',
    'Conferma la scelta',
    NULL
);
