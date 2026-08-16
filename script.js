import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAxuyaH2Oszddmsd8fNlcc-tGo6QN3r_GQ",
    authDomain: "bikehub-4fb57.firebaseapp.com",
    projectId: "bikehub-4fb57",
    storageBucket: "bikehub-4fb57.firebasestorage.app",
    messagingSenderId: "952858705924",
    appId: "1:952858705924:web:be6548cf16b2463d4ff551",
    measurementId: "G-2T4HXRLYQL"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const IMGBB_API_KEY = '7716f9a03e1a8a25c192d6e386047230'; // Προσωρινό κλειδί

let currentUsername = "";

window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('bikehub_username');
    if (savedUser) {
        currentUsername = savedUser;
        document.getElementById('name-modal').style.display = 'none';
        document.getElementById('display-username').innerText = currentUsername;
    }
    updateShareLinks();
    initRealtimeChat();
    initRealtimeRides();
    initRealtimeRoutes(); // Φόρτωση αποθηκευμένων διαδρομών

    document.getElementById('save-name-btn').addEventListener('click', saveModalUsername);
    document.getElementById('send-chat-btn').addEventListener('click', sendChatMessage);
    document.getElementById('add-ride-btn').addEventListener('click', addNewRide);
    document.getElementById('send-email-btn').addEventListener('click', sendEmailInvite);

    document.getElementById('drop-zone').addEventListener('click', () => {
        document.getElementById('real-file-input').click();
    });

    // Ανέβασμα στο ImgBB και αποθήκευση στη βάση
    document.getElementById('real-file-input').addEventListener('change', async function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('image', file);

        try {
            const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            
            if (data.success) {
                const imageUrl = data.data.url;
                
                // Αποθήκευση στη βάση δεδομένων (Firestore)
                await addDoc(collection(db, "routes"), {
                    imageUrl: imageUrl,
                    user: currentUsername,
                    timestamp: Date.now()
                });

                alert("Η διαδρομή ανέβηκε και αποθηκεύτηκε επιτυχώς!");
            }
        } catch (error) {
            console.error("Σφάλμα:", error);
            alert("Αποτυχία ανεβάσματος εικόνας.");
        }
    });
});

function saveModalUsername() {
    const inputVal = document.getElementById('modal-username-input').value.trim();
    if (!inputVal) return;
    currentUsername = inputVal;
    localStorage.setItem('bikehub_username', currentUsername);
    document.getElementById('name-modal').style.display = 'none';
    document.getElementById('display-username').innerText = "Καλώς ήρθες, " + currentUsername;
}

// Chat
async function sendChatMessage() {
    const input = document.getElementById('chat-text');
    const text = input.value.trim();
    if(!text) return;
    await addDoc(collection(db, "chats"), { user: currentUsername, text: text, timestamp: Date.now() });
    input.value = '';
}

function initRealtimeChat() {
    const q = query(collection(db, "chats"), orderBy("timestamp", "asc"));
    onSnapshot(q, (snapshot) => {
        const chatBox = document.getElementById('chat-box');
        chatBox.innerHTML = '';
        snapshot.forEach((doc) => {
            const data = doc.data();
            chatBox.innerHTML += `<div><b>${escapeHtml(data.user)}:</b> ${escapeHtml(data.text)}</div>`;
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    });
}

// Routes / Screenshots
function initRealtimeRoutes() {
    const q = query(collection(db, "routes"), orderBy("timestamp", "desc"));
    onSnapshot(q, (snapshot) => {
        const previewContainer = document.getElementById('map-preview');
        previewContainer.innerHTML = ''; // Καθαρισμός για να μπουν όλες οι ενημερωμένες
        
        snapshot.forEach((doc) => {
            const data = doc.data();
            previewContainer.innerHTML += `
                <div style="margin-top: 10px; background: #fafafa; padding: 10px; border-radius: 10px; border: 1px solid #eee;">
                    <small><b>${escapeHtml(data.user || 'Χρήστης')}</b></small>
                    <img src="${data.imageUrl}" alt="Διαδρομή" style="width: 100%; border-radius: 8px; margin-top: 5px; display: block;">
                </div>
            `;
        });
    });
}

// Rides
window.joinRide = async function(rideId) {
    if (!currentUsername) { alert("Εισάγετε το όνομά σας πρώτα."); return; }
    const rideRef = doc(db, "rides", rideId);
    await updateDoc(rideRef, { participants: arrayUnion(currentUsername) });
};

async function addNewRide() {
    const title = document.getElementById('ride-title').value.trim();
    const dateInput = document.getElementById('ride-date').value;
    if (!title || !dateInput) return;
    await addDoc(collection(db, "rides"), {
        title: title,
        date: dateInput.replace('T', ' '),
        participants: [currentUsername],
        timestamp: Date.now()
    });
}

function initRealtimeRides() {
    const q = query(collection(db, "rides"), orderBy("timestamp", "desc"));
    onSnapshot(q, (snapshot) => {
        const container = document.getElementById('rides-container');
        container.innerHTML = '';
        snapshot.forEach((doc) => {
            const ride = doc.data();
            const list = ride.participants ? ride.participants.join(', ') : 'Κανείς';
            container.innerHTML += `
                <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-top:8px; border:1px solid #eee;">
                    <b>${escapeHtml(ride.title)}</b><br>
                    <small>📅 ${ride.date}</small>
                    <div style="font-size:0.8rem; margin:5px 0;"><b>Συμμετέχοντες:</b> ${list}</div>
                    <button onclick="window.joinRide('${doc.id}')">Συμμετοχή</button>
                </div>`;
        });
    });
}

function updateShareLinks() {
    const shareUrl = window.location.href;
    document.getElementById('whatsapp-link').href = `https://api.whatsapp.com/send?text=Έλα στο BikeHub: ${shareUrl}`;
    document.getElementById('messenger-link').href = `fb-messenger://share?link=${encodeURIComponent(shareUrl)}`;
    document.getElementById('facebook-link').href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
    document.getElementById('email-link').href = `mailto:?subject=Πρόσκληση στο BikeHub&body=Έλα στην παρέα μας: ${shareUrl}`;
}

function sendEmailInvite() {
    const emailInput = document.getElementById('invite-email').value;
    if(!emailInput) return;
    const shareUrl = window.location.href;
    window.location.href = `mailto:${emailInput}?subject=Πρόσκληση στο BikeHub&body=Έλα στην παρέα μας: ${shareUrl}`;
}

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
