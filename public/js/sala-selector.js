// sala-selector.js - moved from inline script in sala-selector.html
(function () {
    let currentAction = 'create';
    const publicBtn = document.getElementById('publicBtn');
    const privateBtn = document.getElementById('privateBtn');
    const privateModal = document.getElementById('privateModal');
    const createBtn = document.getElementById('createBtn');
    const joinBtn = document.getElementById('joinBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const confirmBtn = document.getElementById('confirmBtn');
    const createForm = document.getElementById('createForm');
    const joinForm = document.getElementById('joinForm');

    if (!publicBtn || !privateBtn || !privateModal || !createBtn || !joinBtn || !cancelBtn || !confirmBtn || !createForm || !joinForm) {
        console.warn('[SALA] Elementos de sala-selector no encontrados en DOM');
        return;
    }

    // Sala Pública
    publicBtn.addEventListener('click', () => {
        window.location.href = `/html/practica3.html?room=publicRoom&type=public`;
    });

    // Abrir Modal Privada
    privateBtn.addEventListener('click', () => {
        privateModal.classList.add('active');
        currentAction = 'create';
        updateUI();
    });

    // Cambiar entre Crear y Unirse
    document.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.action-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentAction = e.target.dataset.action;
            updateUI();
        });
    });

    function updateUI() {
        if (currentAction === 'create') {
            createForm.classList.add('active');
            joinForm.classList.remove('active');
            confirmBtn.textContent = 'Crear Sala';
        } else {
            createForm.classList.remove('active');
            joinForm.classList.add('active');
            confirmBtn.textContent = 'Unirse';
        }
    }

    // Confirmar
    confirmBtn.addEventListener('click', () => {
        if (currentAction === 'create') {
            const roomName = document.getElementById('roomNameInput').value.trim();
            const errorDiv = document.getElementById('createError');

            if (!roomName) {
                errorDiv.textContent = 'Ingresa un nombre para la sala';
                errorDiv.style.display = 'block';
                return;
            }
            if (roomName.length < 3) {
                errorDiv.textContent = 'Mínimo 3 caracteres';
                errorDiv.style.display = 'block';
                return;
            }
            if (!/^[a-zA-Z0-9-_]+$/.test(roomName)) {
                errorDiv.textContent = 'Solo letras, números, guiones';
                errorDiv.style.display = 'block';
                return;
            }

            window.location.href = `/html/practica3.html?room=${roomName}&type=private`;
        } else {
            const roomCode = document.getElementById('roomCodeInput').value.trim();
            const errorDiv = document.getElementById('joinError');

            if (!roomCode) {
                errorDiv.textContent = 'Ingresa el código de la sala';
                errorDiv.style.display = 'block';
                return;
            }

            window.location.href = `/html/practica3.html?room=${roomCode}&type=private`;
        }
    });

    // Cancelar
    cancelBtn.addEventListener('click', () => {
        privateModal.classList.remove('active');
        const rn = document.getElementById('roomNameInput');
        const rc = document.getElementById('roomCodeInput');
        const ce = document.getElementById('createError');
        const je = document.getElementById('joinError');
        if (rn) rn.value = '';
        if (rc) rc.value = '';
        if (ce) ce.style.display = 'none';
        if (je) je.style.display = 'none';
    });

    // Enter en inputs
    const roomNameInput = document.getElementById('roomNameInput');
    const roomCodeInput = document.getElementById('roomCodeInput');
    if (roomNameInput) {
        roomNameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') confirmBtn.click(); });
    }
    if (roomCodeInput) {
        roomCodeInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') confirmBtn.click(); });
    }

    // Cerrar modal al clickear fuera
    privateModal.addEventListener('click', (e) => {
        if (e.target === privateModal) {
            cancelBtn.click();
        }
    });
})();
