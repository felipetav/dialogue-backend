


const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const mongoose = require('mongoose');
const app = express();

app.use(cors());
app.use(express.json());

// 1. CONNECT TO MONGODB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB!'))
    .catch(err => console.error('Mongo Error:', err));

// 2. DEFINE SCHEMA (UPDATED FOR FLASHCARDS)
const DialogueSchema = new mongoose.Schema({
    number: { type: Number, required: true, unique: true },
    title: String,
    audioDriveId: String,
    transcriptText: String,
    highlights: [{
        russian: String,        // The highlighted word/phrase
        translation: String,    // The general context translation
        fullSentence: String,   // NEW: The full Russian sentence context
        translatedWord: String, // NEW: The specific Google Translate result
        date: { type: Date, default: Date.now }
    }]
});

const Dialogue = mongoose.model('Dialogue', DialogueSchema);

// GOOGLE DRIVE SETUP
const getAuth = () => {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    return new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
};

// !!! REPLACE THIS WITH YOUR REAL FOLDER ID !!!
const FOLDER_ID = '1xA6Ckfyi_mXEES4h_olxmnJm2i8ueECR'; 

app.get('/', (req, res) => res.send('Dialogue API is Running 🚀'));

// HELPER: Download text from Drive
async function downloadDriveText(fileId) {
    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
    return res.data;
}

// ---------------- API ENDPOINTS ----------------

// A. LIST DIALOGUES
app.get('/api/dialogues', async (req, res) => {
    try {
        const auth = getAuth();
        const drive = google.drive({ version: 'v3', auth });
        
        const driveRes = await drive.files.list({
            q: `'${FOLDER_ID}' in parents and trashed=false`,
            fields: 'files(id, name)',
            pageSize: 1000
        });

        const dbDialogues = await Dialogue.find();
        const dialogues = {};

        driveRes.data.files.forEach(file => {
            const audioMatch = file.name.match(/^audio(\d+)\./i);
            if (audioMatch) {
                const num = parseInt(audioMatch[1]);
                if (!dialogues[num]) dialogues[num] = { number: num };
                dialogues[num].audioId = file.id;
            }
            const textMatch = file.name.match(/^transcript(\d+)\.txt$/i);
            if (textMatch) {
                const num = parseInt(textMatch[1]);
                if (!dialogues[num]) dialogues[num] = { number: num };
                dialogues[num].transcriptId = file.id;
            }
        });

        const result = Object.values(dialogues).map(d => {
            const dbEntry = dbDialogues.find(db => db.number === d.number);
            return {
                number: d.number,
                label: dbEntry?.title || `Dialogue ${d.number}`,
                audioId: d.audioId,
                transcriptId: d.transcriptId,
                hasHighlights: (dbEntry?.highlights || []).length > 0
            };
        }).sort((a, b) => a.number - b.number);

        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// B. GET SINGLE DIALOGUE
app.get('/api/dialogues/:number', async (req, res) => {
    try {
        const num = parseInt(req.params.number);
        let doc = await Dialogue.findOne({ number: num });

        if (!doc || !doc.transcriptText) {
            const auth = getAuth();
            const drive = google.drive({ version: 'v3', auth });
            const listRes = await drive.files.list({
                q: `'${FOLDER_ID}' in parents and name = 'transcript${num}.txt'`,
                fields: 'files(id)',
            });

            if (listRes.data.files.length > 0) {
                const txtId = listRes.data.files[0].id;
                const textContent = await downloadDriveText(txtId);
                
                if (!doc) doc = new Dialogue({ number: num, title: `Dialogue ${num}` });
                doc.transcriptText = textContent;
                await doc.save();
            }
        }

        res.json({
            transcript: doc?.transcriptText || "",
            highlights: doc?.highlights || []
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// C. SAVE HIGHLIGHTS
app.post('/api/dialogues/:number/highlights', async (req, res) => {
    try {
        const num = req.params.number;
        let doc = await Dialogue.findOne({ number: num });
        if (!doc) {
            doc = new Dialogue({ number: num, title: `Dialogue ${num}` });
        }
        // Save the full object (including fullSentence and translatedWord)
        doc.highlights = req.body;
        await doc.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// D. NEW: GET ALL HIGHLIGHTS FOR TRAINING
app.get('/api/all-highlights', async (req, res) => {
    try {
        // Find dialogues that have highlights
        const dialogues = await Dialogue.find({ 'highlights.0': { $exists: true } });
        
        const allHighlights = [];
        
        dialogues.forEach(d => {
            if (d.highlights) {
                d.highlights.forEach(h => {
                    allHighlights.push({
                        russian: h.russian,
                        translation: h.translation,
                        // Provide fallbacks in case old data doesn't have these fields
                        fullSentence: h.fullSentence || h.russian, 
                        translatedWord: h.translatedWord || null,
                        dialogueNumber: d.number
                    });
                });
            }
        });
        
        res.json(allHighlights);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch highlights' });
    }
});

// E. STREAM AUDIO
app.get('/api/audio/:fileId', async (req, res) => {
    try {
        const auth = getAuth();
        const drive = google.drive({ version: 'v3', auth });
        const result = await drive.files.get(
            { fileId: req.params.fileId, alt: 'media' },
            { responseType: 'stream' }
        );
        result.data.pipe(res);
    } catch (error) {
        res.status(500).send('Audio Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
