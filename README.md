# Fabietto🦋🤍

Chat personale con accesso diretto, ottimizzata per iPhone. Testo, foto, video e registrazioni vocali vengono salvati in IndexedDB sul dispositivo, senza invio a un server. Ogni browser ha una chat indipendente.

## Pubblicazione su GitHub Pages

Caricare questi file nella radice della repository. In Settings → Pages selezionare Deploy from a branch, il branch contenente i file e la cartella / (root). Usare l'indirizzo HTTPS restituito da GitHub Pages. Foto e codice pubblicati sono accessibili ai visitatori; i messaggi restano sul dispositivo.

## Conservazione dei messaggi

Chiudere e riaprire la pagina nello stesso browser e allo stesso indirizzo conserva i messaggi. Cambiare dominio, browser o dispositivo non trasferisce i dati. La cancellazione dei dati del sito, la navigazione privata e la rimozione automatica dei dati possono perderli. Esportare regolarmente un backup da Impostazioni e verificare il file scaricato. I backup JSON contengono messaggi e allegati in chiaro: custodirli privatamente. Il ripristino sostituisce atomicamente la chat locale dopo conferma.

Non esiste password o accesso amministratore ai messaggi. Chi usa il dispositivo sbloccato può leggere la chat. Il proprietario del codice può modificarlo; non è una garanzia di segretezza contro futuri aggiornamenti malevoli.

## Funzioni e limiti

- Allegati foto/video fino a 50 MB ciascuno.
- Registrazioni vocali fino a cinque minuti, con permesso microfono e HTTPS.
- Nessuna risposta automatica, stato online o conferma di lettura simulata.
- Tema scuro ispirato allo screenshot fornito; nessuna affiliazione con WhatsApp.
- Nessun servizio esterno, tracciamento o dipendenza di runtime.

## Verifica prima dell'uso

Su Safari dell'iPhone: inviare un testo e una foto, registrare un vocale, chiudere e riaprire; esportare un backup in File e verificarne il ripristino con dati di prova. Provare la tastiera e un video. Il codice è controllato staticamente, ma il comportamento sul dispositivo fisico deve essere verificato.
