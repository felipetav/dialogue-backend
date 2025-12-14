const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const mongoose = require('mongoose'); // The Database Tool
const app = express();

app.use(cors());
app.use(express.json());

// 1. CONNECT TO MONGODB
// This connects to your "Library"
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB!'))
    .catch(err => console.error('Mongo Error:', err));

// 2. DEFINE THE "ONE FILE" STRUCTURE
// This is your "All-in-One" JSON structure
const DialogueSchema = new mongoose.Schema({
    number: { type: Number, required: true, unique: true }, // e.g., 1
    title: String,             // e.g., "Dialogue 1"
    audioDriveId: String,      // The ID from Google Drive
    transcriptText: String,    // The full Russian/English text
    highlights: [{             // The list of highlights
        russian: String,
        translation: String,
        date: { type: Date, default: Date.now }
    }]
});

const Dialogue = mongoose.model('Dialogue', DialogueSchema);

// GOOGLE DRIVE SETUP (For Audio Streaming Only)
const getAuth = () => {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    return new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
};

const FOLDER_ID = '1xA6Ckfyi_mXEES4h_olxmnJm2i8ueECR'; // <--- CHECK THIS!

// ---------------- API ENDPOINTS ----------------

app.get('/', (req, res) => res.send('Dialogue API is Running 🚀'));

// A. SYNC/LIST DIALOGUES
// This is smart: It checks Drive for audio, checks Mongo for Text/Highlights, 
// and merges them for the frontend.
app.get('/api/dialogues', async (req, res) => {
    try {
        // 1. Get Audio Files from Drive
        const auth = getAuth();
        const drive = google.drive({ version: 'v3', auth });
        const driveRes = await drive.files.list({
            q: `'${FOLDER_ID}' in parents and name contains 'audio'`,
            fields: 'files(id, name)',
        });

        // 2. Get Data from MongoDB
        const dbDialogues = await Dialogue.find();

        // 3. Merge them
        const result = [];
        
        driveRes.data.files.forEach(file => {
            const match = file.name.match(/audio(\d+)/i);
            if (match) {
                const num = parseInt(match[1]);
                // Find matching DB entry
                const dbEntry = dbDialogues.find(d => d.number === num);
                
                result.push({
                    number: num,
                    label: dbEntry?.title || `Dialogue ${num}`,
                    audioId: file.id,
                    // If we have DB data, send true/false flags
                    hasTranscript: !!dbEntry?.transcriptText,
                    hasHighlights: (dbEntry?.highlights || []).length > 0
                });
            }
        });

        // Sort by number
        result.sort((a, b) => a.number - b.number);
        res.json(result);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// B. GET FULL DIALOGUE DATA (Text + Highlights)
app.get('/api/dialogues/:number', async (req, res) => {
    try {
        const num = req.params.number;
        let doc = await Dialogue.findOne({ number: num });
        
        if (!doc) {
            // If not in DB, try to find transcript in Drive one last time to "import" it
            // (Optional helper logic, for now let's just return empty)
            return res.json({ transcript: "", highlights: [] });
        }
        
        res.json({
            transcript: doc.transcriptText || "",
            highlights: doc.highlights || []
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// C. SAVE HIGHLIGHTS
app.post('/api/dialogues/:number/highlights', async (req, res) => {
    try {
        const num = req.params.number;
        const newHighlights = req.body; // Expects array of highlights

        // Find the dialogue, or create it if it doesn't exist
        let doc = await Dialogue.findOne({ number: num });
        if (!doc) {
            doc = new Dialogue({ number: num, title: `Dialogue ${num}` });
        }

        doc.highlights = newHighlights; // Overwrite highlights
        await doc.save();

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// D. STREAM AUDIO (Direct from Drive)
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
