-- Version 1 of the MERL-T notice (INFORMATIVA_MERLT), the text a person reads before choosing a
-- MERL-T consent level. Its wording follows the owner's decisions of 18 October 2026 (spec
-- docs/superpowers/specs/2026-10-13-merlt-data-protection-design.md §5). Written by the migration,
-- hence no author; a change is a new version saved from the admin screen, never an edit of this
-- row. In its own migration because Postgres refuses to use an enum value in the transaction
-- that added it.
INSERT INTO "lingo_testi_versioni" ("id", "chiave", "versione", "titolo", "corpo", "conferma", "azione", "autore_id")
VALUES (
    'b530fcb2-f80c-4b32-8940-c9127c55b83c',
    'INFORMATIVA_MERLT',
    1,
    'MERL-T: i dati della tua attività',
    'MERL-T è la parte di VisuaLex che impara da come i giuristi leggono e usano le fonti, per migliorare la ricerca, i collegamenti tra norme e sentenze e le risposte dell''assistente. Per farlo usa dati sulla tua attività. Li raccoglie solo se acconsenti, e puoi cambiare scelta in qualsiasi momento da Impostazioni › Dati MERL-T.

Il titolare del trattamento e il recapito per esercitare i tuoi diritti saranno indicati qui prima dell''apertura pubblica di VisuaLex. Fino ad allora, per qualsiasi domanda o richiesta usa il pulsante «Invia feedback» dell''applicazione.

Leggere, cercare e lavorare in VisuaLex non richiede alcun consenso. Se scegli «Nessuna raccolta», MERL-T non riceve nulla della tua attività, e tutto il resto funziona come prima.

Livello «Base». Raccogliamo, legati al tuo account:
– gli articoli che apri, per quanto tempo restano a schermo e fin dove li scorri;
– le evidenziazioni: il testo evidenziato (fino a 2.000 caratteri), la posizione e il colore;
– le note sul testo: il passo a cui sono ancorate, mai il testo della nota;
– i segnalibri e gli articoli che aggiungi a un dossier, con le etichette che scegli e l''identificativo del dossier;
– le citazioni che apri dall''anteprima, con il testo della citazione;
– nel Forum, i «mi piace» e le proposte che accetti o rifiuti (cosa, mai chi l''ha scritto);
– le domande che fai all''assistente e le risposte che ricevi.
A ogni dato si aggiungono il tuo identificativo VisuaLex e il livello di autorevolezza e la qualifica che MERL-T ti attribuisce.

Livello «Completo». In più raccogliamo:
– i giudizi e i commenti che dai alle risposte dell''assistente e alle fonti che cita;
– quando apri una citazione dall''anteprima, il testo della citazione riconosciuta e circa 1.000 caratteri dell''articolo intorno a essa, inviati in automatico per insegnare a MERL-T a riconoscere le citazioni; e le conferme, correzioni e segnalazioni che fai sulle citazioni;
– i documenti che carichi, le entità e le relazioni che proponi per il grafo e i voti che dai alle proposte degli altri.

Perché e su quale base. Trattiamo questi dati solo con il tuo consenso (art. 6, par. 1, lett. a, del Regolamento UE 2016/679), per migliorare il servizio e per studiarne il funzionamento. L''autorevolezza serve solo a pesare i tuoi contributi nell''apprendimento di MERL-T: non produce alcun effetto su di te. Quando i dati escono da VisuaLex per la ricerca, il tuo identificativo è sostituito da un codice e i testi sono tolti.

Chi li vede. I dati restano sui server di VisuaLex. Le domande che fai all''assistente e, al livello «Completo», il testo dei documenti che carichi sono elaborati da modelli linguistici di fornitori esterni tramite il servizio OpenRouter, senza il tuo identificativo, anche fuori dall''Unione europea, con le garanzie previste dal Regolamento. Non vendiamo né cediamo i dati a nessuno.

Per quanto tempo. Gli eventi di attività (letture, evidenziazioni, note, segnalibri, citazioni, Forum) sono cancellati in automatico dopo 12 mesi. Le domande all''assistente, i giudizi e le segnalazioni sulle citazioni dopo 24 mesi. Se elimini i dati o l''account li cancelliamo tutti, senza attendere queste scadenze. I contributi al grafo che la comunità ha già approvato restano, senza più alcun legame con te.

I tuoi diritti. Da Impostazioni › Dati MERL-T puoi in ogni momento:
– scaricare una copia dei tuoi dati (accesso e portabilità);
– eliminarli («Elimina i miei dati MERL-T»); eliminando l''account si eliminano anche questi;
– cambiare livello o revocare il consenso. La revoca vale per il futuro: ti chiediamo se eliminare anche quanto raccolto fino a quel momento.
Per la rettifica, la limitazione, l''opposizione o qualsiasi altra richiesta usa «Invia feedback». Hai anche il diritto di proporre reclamo al Garante per la protezione dei dati personali (www.garanteprivacy.it).',
    'Ho letto l''informativa',
    'Conferma la scelta',
    NULL
);
