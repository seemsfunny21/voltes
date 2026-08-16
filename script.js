import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAxuyaH2Oszddmsd8fNlcc-tGo6QN3r_GQ",
    authDomain: "bikehub-4fb57.firebaseapp.com",
    projectId: "bikehub-4fb57",
    storageBucket: "bikehub-4fb57.firebasestorage.app",
    messagingSenderId: "952858705924",
    appId: "1:952858705924:web:be6548cf16b2463d4ff551"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let currentUsername = "";
let showAllRides = false; 

// Reference to global config in Firestore
const configRef = doc(db, "config", "routes_data");

window.addEventListener('DOMContentLoaded', async () => {
    const savedUser = localStorage.getItem('bikehub_username');
    if (savedUser) {
        currentUsername = savedUser;
        document.getElementById('name-modal').style.display = 'none';
        document.getElementById('display-username').innerText = currentUsername;
    }
    
    // Initialize real-time listeners
    initRealtimeConfig();
    initRealtimeChat();
    initRealtimeRides();
    
    document.getElementById('save-name-btn').addEventListener('click', saveModalUsername);
    document.getElementById('send-chat-btn').addEventListener('click', sendChatMessage);
    document.getElementById('add-ride-btn').addEventListener('click', addNewRide);
});

function initRealtimeConfig() {
    onSnapshot(configRef, (docSnap) => {
        const data = docSnap.exists() ? docSnap.data() : { routes: [], startPoints: [] };
        populateDropdowns(data.routes || [], data.startPoints || []);
    });
}

function populateDropdowns(routes, startPoints) {
    const routeSelect = document.getElementById('ride-title-select');
    const startSelect = document.getElementById('start-point-select');
    
    routeSelect.innerHTML = '<option value="">Επιλέξτε διαδρομή...</option><option value="NEW">+ Προσθήκη νέας...</option>';
    routes.forEach(r => routeSelect.innerHTML += `<option value="${r}">${r}</option>`);
    
    startSelect.innerHTML = '<option value="">Επιλέξτε αφετηρία...</option><option value="NEW">+ Προσθήκη νέου...</option>';
    startPoints.forEach(s => startSelect.innerHTML += `<option value="${s}">${s}</option>`);
}

window.checkNewRoute = async function() {
    const select = document.getElementById('ride-title-select');
    if (select.value === 'NEW') {
        const val = prompt("Πώς ονομάζεται η νέα διαδρομή;");
        if (val) {
            await updateDoc(configRef, { routes: arrayUnion(val) });
            select.value = val;
        } else {
            select.value = "";
        }
    }
};

window.checkNewPoint = async function() {
    const select = document.getElementById('start-point-select');
    if (select.value === 'NEW') {
        const val = prompt("Πού είναι η νέα αφετηρία;");
        if (val) {
            await updateDoc(configRef, { startPoints: arrayUnion(val) });
            select.value = val;
        } else {
            select.value = "";
        }
    }
};

function saveModalUsername() {
    const inputVal = document.getElementById('modal-username-input').value.trim();
    if (!inputVal) return;
    currentUsername = inputVal;
    localStorage.setItem('bikehub_username', currentUsername);
    document.getElementById('name-modal').style.display = 'none';
    document.getElementById('display-username').innerText = currentUsername;
}

async function sendChatMessage() {
    const input = document.getElementById('chat-text');
    const text = input.value.trim();
    if(!text) return;
    await addDoc(collection(db, "chats"), { user: currentUsername || 'Χρήστης', text: text, timestamp: Date.now() });
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

window.toggleRide = async function(rideId, isParticipating) {
    if (!currentUsername) { alert("Εισάγετε το όνομα σας πρώτα."); return; }
    const rideRef = doc(db, "rides", rideId);
    if (isParticipating) {
        await updateDoc(rideRef, { participants: arrayRemove(currentUsername) });
    } else {
        await updateDoc(rideRef, { participants: arrayUnion(currentUsername) });
    }
};

window.toggleShowAll = function() {
    showAllRides = !showAllRides;
    initRealtimeRides();
};

async function addNewRide() {
    const title = document.getElementById('ride-title-select').value;
    const start = document.getElementById('start-point-select').value;
    const dateInput = document.getElementById('ride-date').value;
    if (!title || title === "NEW" || !start || start === "NEW" || !dateInput) { alert("Συμπληρώστε όλα τα πεδία!"); return; }
    await addDoc(collection(db, "rides"), {
        title: title,
        start: start,
        date: dateInput.replace('T', ' '),
        participants: [currentUsername],
        timestamp: Date.now()
    });
    document.getElementById('ride-date').value = '';
}

function initRealtimeRides() {
    const q = query(collection(db, "rides"), orderBy("timestamp", "desc"));
    onSnapshot(q, (snapshot) => {
        const container = document.getElementById('rides-container');
        if (!container) return;
        container.innerHTML = '';
        let docs = [];
        snapshot.forEach(doc => docs.push({id: doc.id, ...doc.data()}));
        const displayLimit = showAllRides ? docs.length : 3;
        const visibleDocs = docs.slice(0, displayLimit);
        visibleDocs.forEach((ride) => {
            const participants = ride.participants || [];
            const isJoined = participants.includes(currentUsername);
            const list = participants.length > 0 ? participants.join(', ') : 'Κανείς';
            container.innerHTML += `
                <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-top:8px; border:1px solid #eee;">
                    <b>${escapeHtml(ride.title)}</b><br>
                    <small>📍 ${escapeHtml(ride.start)} | 📅 ${ride.date}</small>
                    <div style="font-size:0.8rem; margin:5px 0;"><b>Συμμετέχοντες:</b> ${list}</div>
                    <button onclick="window.toggleRide('${ride.id}', ${isJoined})">
                        ${isJoined ? 'Ακύρωση' : 'Συμμετοχή'}
                    </button>
                </div>`;
        });
        if (docs.length > 3) {
            container.innerHTML += `
                <button style="margin-top:10px; background: #eee; color: #333;" onclick="window.toggleShowAll()">
                    ${showAllRides ? 'Λιγότερα...' : 'Δείτε περισσότερα (' + (docs.length - 3) + ')'}
                </button>`;
        }
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return str.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}