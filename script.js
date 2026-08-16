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

let currentUsername = "";

// Initial lists
let routes = JSON.parse(localStorage.getItem('bikehub_routes')) || ["Γύρος Λίμνης", "Γεφυράκια (16χλμ)", "Καταρράκτης Κλίφκης"];
let startPoints = JSON.parse(localStorage.getItem('bikehub_startpoints')) || ["Πλατεία Μαβίλης", "Καφετέρια εδώ", "Κατσικά καφετέρια diman"];

window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('bikehub_username');
    if (savedUser) {
        currentUsername = savedUser;
        const modal = document.getElementById('name-modal');
        if (modal) modal.style.display = 'none';
        
        const displayUser = document.getElementById('display-username');
        if (displayUser) displayUser.innerText = currentUsername;
    }
    updateShareLinks();
    initRealtimeChat();
    initRealtimeRides();
    populateDropdowns();

    const saveNameBtn = document.getElementById('save-name-btn');
    if (saveNameBtn) saveNameBtn.addEventListener('click', saveModalUsername);

    const sendChatBtn = document.getElementById('send-chat-btn');
    if (sendChatBtn) sendChatBtn.addEventListener('click', sendChatMessage);

    const addRideBtn = document.getElementById('add-ride-btn');
    if (addRideBtn) addRideBtn.addEventListener('click', addNewRide);
});

function populateDropdowns() {
    const routeSelect = document.getElementById('ride-title-select');
    const startSelect = document.getElementById('start-point-select');
    
    if (routeSelect) {
        routeSelect.innerHTML = '<option value="">Επιλέξτε διαδρομή...</option><option value="NEW">--- Νέα διαδρομή ---</option>';
        routes.forEach(r => routeSelect.innerHTML += `<option value="${r}">${r}</option>');
    }

    if (startSelect) {
        startSelect.innerHTML = '<option value="">Επιλέξτε αφετηρία...</option><option value="NEW">--- Νέο σημείο ---</option>';
        startPoints.forEach(s => startSelect.innerHTML += `<option value="${s}">${s}</option>');
    }
}

// Logic to handle "New" entries
window.checkNewRoute = function() {
    const routeSelect = document.getElementById('ride-title-select');
    if (routeSelect && routeSelect.value === 'NEW') {
        const val = prompt("Εισάγετε νέα διαδρομή:");
        if (val) {
            routes.push(val);
            localStorage.setItem('bikehub_routes', JSON.stringify(routes));
            populateDropdowns();
            routeSelect.value = val;
        }
    }
};

window.checkNewPoint = function() {
    const startSelect = document.getElementById('start-point-select');
    if (startSelect && startSelect.value === 'NEW') {
        const val = prompt("Εισάγετε νέο σημείο αφετηρίας:");
        if (val) {
            startPoints.push(val);
            localStorage.setItem('bikehub_startpoints', JSON.stringify(startPoints));
            populateDropdowns();
            startSelect.value = val;
        }
    }
};

function saveModalUsername() {
    const inputEl = document.getElementById('modal-username-input');
    if (!inputEl) return;
    const inputVal = inputEl.value.trim();
    if (!inputVal) return;
    
    currentUsername = inputVal;
    localStorage.setItem('bikehub_username', currentUsername);
    
    const modal = document.getElementById('name-modal');
    if (modal) modal.style.display = 'none';
    
    const displayUser = document.getElementById('display-username');
    if (displayUser) displayUser.innerText = "Καλώς ήρθες, " + currentUsername;
}

async function sendChatMessage() {
    const input = document.getElementById('chat-text');
    if (!input) return;
    const text = input.value.trim();
    if(!text) return;
    await addDoc(collection(db, "chats"), { user: currentUsername || 'Χρήστης', text: text, timestamp: Date.now() });
    input.value = '';
}

function initRealtimeChat() {
    const q = query(collection(db, "chats"), orderBy("timestamp", "asc"));
    onSnapshot(q, (snapshot) => {
        const chatBox = document.getElementById('chat-box');
        if (!chatBox) return;
        chatBox.innerHTML = '';
        snapshot.forEach((doc) => {
            const data = doc.data();
            chatBox.innerHTML += `<div><b>${escapeHtml(data.user)}:</b> ${escapeHtml(data.text)}</div>`;
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    });
}

window.joinRide = async function(rideId) {
    if (!currentUsername) { alert("Εισάγετε το όνομα σας πρώτα."); return; }
    const rideRef = doc(db, "rides", rideId);
    await updateDoc(rideRef, { participants: arrayUnion(currentUsername) });
};

async function addNewRide() {
    const routeSelect = document.getElementById('ride-title-select');
    const startSelect = document.getElementById('start-point-select');
    const dateInputEl = document.getElementById('ride-date');

    if (!routeSelect || !startSelect || !dateInputEl) return;

    const title = routeSelect.value;
    const start = startSelect.value;
    const dateInput = dateInputEl.value;
    
    if (!title || title === "NEW" || !start || start === "NEW" || !dateInput) { 
        alert("Συμπληρώστε όλα τα πεδία σωστά!"); 
        return; 
    }
    
    await addDoc(collection(db, "rides"), {
        title: title,
        start: start,
        date: dateInput.replace('T', ' '),
        participants: [currentUsername || 'Χρήστης'],
        timestamp: Date.now()
    });
    dateInputEl.value = '';
}

function initRealtimeRides() {
    const q = query(collection(db, "rides"), orderBy("timestamp", "desc"));
    onSnapshot(q, (snapshot) => {
        const container = document.getElementById('rides-container');
        if (!container) return;
        container.innerHTML = '';
        snapshot.forEach((doc) => {
            const ride = doc.data();
            const list = ride.participants ? ride.participants.join(', ') : 'Κανείς';
            container.innerHTML += `
                <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-top:8px; border:1px solid #eee;">
                    <b>${escapeHtml(ride.title)}</b><br>
                    <small>📍 ${escapeHtml(ride.start)} | 📅 ${ride.date}</small>
                    <div style="font-size:0.8rem; margin:5px 0;"><b>Συμμετέχοντες:</b> ${list}</div>
                    <button onclick="window.joinRide('${doc.id}')">Συμμετοχή</button>
                </div>`;
        });
    });
}

function updateShareLinks() {
    const shareUrl = window.location.href;
    const wLink = document.getElementById('whatsapp-link');
    const mLink = document.getElementById('messenger-link');
    const fLink = document.getElementById('facebook-link');
    const eLink = document.getElementById('email-link');

    if(wLink) wLink.href = `https://api.whatsapp.com/send?text=Έλα στο BikeHub: ${shareUrl}`;
    if(mLink) mLink.href = `fb-messenger://share?link=${encodeURIComponent(shareUrl)}`;
    if(fLink) fLink.href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
    if(eLink) eLink.href = `mailto:?subject=Πρόσκληση στο BikeHub&body=Έλα στην παρέα μας: ${shareUrl}`;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
