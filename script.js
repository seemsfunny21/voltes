let currentUsername = "";

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

function sendChatMessage() {
    const chatInput = document.getElementById('chat-text');
    const msg = chatInput.value.trim();
    if (!msg) return;
    console.log("Μήνυμα από " + currentUsername + ": " + msg);
    chatInput.value = "";
}

function addNewRide() {
    const rideTitle = document.getElementById('ride-title').value;
    console.log("Δημιουργία βόλτας: " + rideTitle);
}

// Event Listeners για να δουλεύουν τα modules σωστά
window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('bikehub_username');
    if (savedUser) {
        currentUsername = savedUser;
        document.getElementById('name-modal').style.display = 'none';
        document.getElementById('display-username').innerText = currentUsername;
    }

    const saveBtn = document.getElementById('save-name-btn');
    if (saveBtn) saveBtn.addEventListener('click', saveModalUsername);

    const sendBtn = document.getElementById('send-chat-btn');
    if (sendBtn) sendBtn.addEventListener('click', sendChatMessage);

    const addRideBtn = document.getElementById('add-ride-btn');
    if (addRideBtn) addRideBtn.addEventListener('click', addNewRide);

    document.getElementById('chat-text').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });
});