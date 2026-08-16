import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
});

function saveModalUsername() {
    const inputVal = document.getElementById('modal-username-input').value.trim();
    if (!inputVal) {
        alert("Παρακαλώ εισάγετε ένα έγκυρο όνομα.");
        return;
    }
    currentUsername = inputVal;
    localStorage.setItem('bikehub_username', currentUsername);
    document.getElementById('name-modal').style.display = 'none';
    document.getElementById('display-username').innerText = currentUsername;
}

async function sendChatMessage() {
    const input = document.getElementById('chat-text');
    const text = input.value.trim();
    if(!text) return;
    
    try {
        await addDoc(collection(db, "chats"), {
            user: currentUsername,
            text: text,
            timestamp: Date.now()
        });
        input.value = '';
    } catch (e) {
        console.error("Σφάλμα αποστολής μηνύματος: ", e);
    }
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

function checkEnter(e) {
    if(e.key === 'Enter') sendChatMessage();
}

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.getElementById('drop-zone').addEventListener('click', () => {
    document.getElementById('real-file-input').click();
});

document.getElementById('real-file-input').addEventListener('change', function(e) {
    const reader = new FileReader();
    reader.onload = function(event) {
        const img = document.getElementById('uploaded-map-img');
        img.src = event.target.result;
        img.style.display = 'block';
    }
    if (e.target.files[0]) {
        reader.readAsDataURL(e.target.files[0]);
    }
});

function updateShareLinks() {
    const shareText = "Έλα στην ποδηλατική μας παρέα στο BikeHub! Δες διαδρομές και δήλωσε συμμετοχή.";
    const shareUrl = window.location.href;
    const whatsapp = document.getElementById('whatsapp-link');
    const email = document.getElementById('email-link');
    
    if(whatsapp) whatsapp.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`;
    if(email) email.href = `mailto:?subject=${encodeURIComponent("Πρόσκληση στο BikeHub")}&body=${encodeURIComponent(shareText + '\n\n' + shareUrl)}`;
}

function sendEmailInvite() {
    const emailInput = document.getElementById('invite-email').value;
    if(!emailInput) {
        alert("Παρακαλώ εισάγετε ένα e-mail.");
        return;
    }
    const shareText = "Έλα στην ποδηλατική μας παρέα στο BikeHub!";
    const shareUrl = window.location.href;
    window.location.href = `mailto:${emailInput}?subject=${encodeURIComponent("Πρόσκληση στο BikeHub")}&body=${encodeURIComponent(shareText + '\n\n' + shareUrl)}`;
}

async function addNewRide() {
    const title = document.getElementById('ride-title').value.trim();
    const dateInput = document.getElementById('ride-date').value;
    
    if (!title || !dateInput) {
        alert("Συμπληρώστε τίτλο και ημερομηνία για τη βόλτα.");
        return;
    }

    try {
        await addDoc(collection(db, "rides"), {
            title: title,
            date: dateInput.replace('T', ' '),
            createdBy: currentUsername,
            timestamp: Date.now()
        });
        document.getElementById('ride-title').value = '';
        document.getElementById('ride-date').value = '';
    } catch (e) {
        console.error("Σφάλμα δημιουργίας βόλτας: ", e);
    }
}

function initRealtimeRides() {
    const q = query(collection(db, "rides"), orderBy("timestamp", "asc"));
    onSnapshot(q, (snapshot) => {
        const container = document.getElementById('rides-container');
        container.innerHTML = '';
        snapshot.forEach((doc) => {
            const ride = doc.data();
            container.innerHTML += `
                <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-top:8px; border:1px solid #eee;">
                    <b>${escapeHtml(ride.title)}</b><br>
                    <small>📅 ${ride.date}</small><br>
                    <button onclick="joinRide('${escapeHtml(ride.title)}')" style="padding:6px 12px; font-size:0.85rem; margin-top:6px; width:auto;">Συμμετοχή</button>
                </div>
            `;
        });
    });
}

function joinRide(title) {
    alert(`${currentUsername}, δηλώσατε συμμετοχή στη βόλτα: "${title}"!`);
}
