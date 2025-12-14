const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const app = express();

app.use(cors());
// IMPORTANT: This allows us to receive JSON data from the frontend
app.use(express.json()); 

const getAuth = () => {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    return new google.auth.GoogleAuth({
        credentials,
        // CHANGED: We removed ".readonly" to allow saving files
        scopes: ['https://www.googleapis.com/auth/drive'],
    });
};

const FOLDER_ID = 'YOUR_DRIVE_FOLDER_ID_HERE'; // <--- MAKE SURE THIS IS CORRECT

app.get('/', (req, res) => res.send('Backend is running with Write Access! 🚀'));

// 1. List Dialogues (Updated to find highlights)
app.get('/api/dialogues', async (req, res) => {
    try {
        const auth = getAuth();
        const drive = google.drive({ version: 'v3', auth });

        const response = await drive.files.list({
            q: `'${FOLDER_ID}' in parents and trashed=false`,
            fields: 'files(id, name)',
            pageSize: 1000
        });

        const files = response.data.files;
        const dialogues = {};

        files.forEach(file => {
            const audioMatch = file.name.match(/^audio(\d+)\.(mp3|wav|webm)$/i);
            const textMatch = file.name.match(/^transcript(\d+)\.txt$/i);
            // NEW: Look for highlights files
            const highMatch = file.name.match(/^highlights(\d+)\.json$/i);

            if (audioMatch) {
                const num = audioMatch[1];
                if (!dialogues[num]) dialogues[num] = {};
                dialogues[num].audioId = file.id;
            }
            if (textMatch) {
                const num = textMatch[1];
                if (!dialogues[num]) dialogues[num] = {};
                dialogues[num].transcriptId = file.id;
            }
            if (highMatch) {
                const num = highMatch[1];
                if (!dialogues[num]) dialogues[num] = {};
                dialogues[num].highlightsId = file.id;
            }
        });

        const result = Object.keys(dialogues)
            .filter(num => dialogues[num].audioId && dialogues[num].transcriptId)
            .sort((a, b) => parseInt(a) - parseInt(b))
            .map(num => ({
                number: num,
                label: `Dialogue ${num}`,
                ...dialogues[num]
            }));

        res.json(result);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// 2. Stream File (Unchanged)
app.get('/api/file/:fileId', async (req, res) => {
    try {
        const auth = getAuth();
        const drive = google.drive({ version: 'v3', auth });
        
        const result = await drive.files.get(
            { fileId: req.params.fileId, alt: 'media' },
            { responseType: 'stream' }
        );
        result.data.pipe(res);
    } catch (error) {
        res.status(500).send('Error streaming file');
    }
});

// 3. NEW: Save Highlights
app.post('/api/dialogues/:number/highlights', async (req, res) => {
    try {
        const auth = getAuth();
        const drive = google.drive({ version: 'v3', auth });
        const number = req.params.number;
        const filename = `highlights${number}.json`;
        const newContent = JSON.stringify(req.body, null, 2);

        // First, check if file exists
        const listRes = await drive.files.list({
            q: `name='${filename}' and '${FOLDER_ID}' in parents and trashed=false`,
            fields: 'files(id)',
        });

        if (listRes.data.files.length > 0) {
            // UPDATE existing file
            const fileId = listRes.data.files[0].id;
            await drive.files.update({
                fileId: fileId,
                media: { mimeType: 'application/json', body: newContent }
            });
            res.json({ status: 'updated', fileId });
        } else {
            // CREATE new file
            const createRes = await drive.files.create({
                requestBody: {
                    name: filename,
                    parents: [FOLDER_ID]
                },
                media: {
                    mimeType: 'application/json',
                    body: newContent
                }
            });
            res.json({ status: 'created', fileId: createRes.data.id });
        }

    } catch (error) {
        console.error('Save error:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
