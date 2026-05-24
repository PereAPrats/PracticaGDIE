(() => {
    const roomLabel = document.getElementById('remoteRoomLabel');
    const connectionState = document.getElementById('connectionState');
    const waitingView = document.getElementById('waitingView');
    const questionView = document.getElementById('questionView');
    const questionText = document.getElementById('questionText');
    const answerGrid = document.getElementById('answerGrid');
    const resultView = document.getElementById('resultView');
    const resultTitle = document.getElementById('resultTitle');
    const resultText = document.getElementById('resultText');

    let activeQuestionId = null;
    let activeQuestion = null;
    let handledResultQuestionId = null;
    let timeoutTimer = null;

    if (roomLabel && window.roomId) {
        roomLabel.textContent = `Sala: ${window.roomId}`;
    }

    function setConnectionText(text) {
        if (connectionState) {
            connectionState.textContent = text;
        }
    }

    function hideResult() {
        if (resultView) {
            resultView.style.display = 'none';
        }
    }

    function stopTimeoutTimer() {
        if (timeoutTimer) {
            clearTimeout(timeoutTimer);
            timeoutTimer = null;
        }
    }

    function showWaiting() {
        if (waitingView) {
            waitingView.style.display = 'block';
        }
        if (questionView) {
            questionView.style.display = 'none';
        }
    }

    function showQuestion(quiz) {
        if (!quiz || !questionText || !answerGrid) {
            return;
        }

        hideResult();
        if (waitingView) {
            waitingView.style.display = 'none';
        }
        if (questionView) {
            questionView.style.display = 'block';
        }

        questionText.textContent = quiz.pregunta || 'Pregunta';
        answerGrid.innerHTML = '';

        (quiz.opciones || []).forEach((opcion, index) => {
            const label = typeof opcion === 'string'
                ? opcion
                : (opcion?.texto || opcion?.label || opcion?.text || `Opción ${index + 1}`);

            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.style.cssText = 'padding:14px 16px; border:none; border-radius:14px; font-size:1rem; font-weight:700; cursor:pointer; background:#f2f4f8; color:#1b2230;';
            button.addEventListener('click', () => sendAnswer(index));
            answerGrid.appendChild(button);
        });
    }

    function markAnswered() {
        if (answerGrid) {
            Array.from(answerGrid.querySelectorAll('button')).forEach((button) => {
                button.disabled = true;
                button.style.opacity = '0.65';
            });
        }
    }

    function sendAnswer(selectedIndex) {
        if (!activeQuestionId) {
            return;
        }

        const payload = {
            questionId: activeQuestionId,
            selectedIndex,
            userId: window.userId,
            roomId: window.roomId
        };

        const sent = window.quizBridge && typeof window.quizBridge.sendAnswer === 'function'
            ? window.quizBridge.sendAnswer(payload)
            : false;

        if (!sent && window.socket && window.socket.connected) {
            window.socket.emit('question-answer', payload);
        }

        if (resultView) {
            resultView.style.display = 'block';
        }
        if (resultTitle) {
            resultTitle.textContent = 'Respuesta enviada';
        }
        if (resultText) {
            resultText.textContent = 'Esperando validación desde el ordenador...';
        }

        markAnswered();
        setConnectionText('Respuesta enviada');
    }

    function handleQuestionStart(detail) {
        const quiz = detail?.quiz;
        if (!quiz || !detail?.questionId) {
            return;
        }

        if (activeQuestionId === detail.questionId) {
            return;
        }

        activeQuestionId = detail.questionId;
        activeQuestion = detail;
        handledResultQuestionId = null;
        showQuestion(quiz);
        setConnectionText('Pregunta activa');

        // Enviar ack para que el PC sepa que este móvil ha recibido la pregunta
        const ackPayload = {
            questionId: detail.questionId,
            userId: window.userId,
            roomId: window.roomId
        };

        if (window.quizBridge && typeof window.quizBridge.sendQuestionStartAck === 'function') {
            try { window.quizBridge.sendQuestionStartAck(ackPayload); } catch (e) { /* ignore */ }
        } else if (window.socket && window.socket.connected) {
            window.socket.emit('question-start-ack', ackPayload);
        }

        stopTimeoutTimer();
        timeoutTimer = window.setTimeout(() => {
            if (activeQuestionId === detail.questionId) {
                if (resultView) {
                    resultView.style.display = 'block';
                }
                if (resultTitle) {
                    resultTitle.textContent = 'Tiempo agotado';
                }
                if (resultText) {
                    resultText.textContent = 'No llegó ninguna respuesta a tiempo.';
                }
            }
        }, Number(detail.timeoutMs) || 20000);
    }

    function handleQuestionResult(detail) {
        if (!detail || detail.questionId !== activeQuestionId) {
            return;
        }

        if (handledResultQuestionId === detail.questionId) {
            return;
        }

        handledResultQuestionId = detail.questionId;

        // Liberar la pregunta activa de inmediato para evitar que preguntas
        // siguientes muy cercanas se ignoren. La UI de resultado se mantiene
        // visible durante un breve periodo, pero `activeQuestionId` se pone a null
        // inmediatamente para aceptar nuevas preguntas.
        stopTimeoutTimer();
        activeQuestionId = null;
        activeQuestion = null;

        const selectedIndex = Number.isInteger(detail.selectedIndex)
            ? detail.selectedIndex
            : Number(detail.selectedIndex);

        if (resultView) {
            resultView.style.display = 'block';
        }
        if (resultTitle) {
            resultTitle.textContent = detail?.reason === 'tie' ? 'Empate' : 'Validación finalizada';
        }
        if (resultText) {
            if (detail?.reason === 'tie') {
                resultText.textContent = 'Empate detectado. Se repetirá el capítulo.';
            } else {
                resultText.textContent = Number.isInteger(selectedIndex)
                    ? `La mayoría eligió la opción ${selectedIndex + 1}.`
                    : 'La pregunta fue resuelta.';
            }
        }

        // Después de un breve retardo ocultamos el resultado y volvemos a modo espera.
        setTimeout(() => {
            stopTimeoutTimer();
            showWaiting();
            hideResult();
            setConnectionText('Conectado');
            handledResultQuestionId = null;
        }, 1400);
    }

    window.addEventListener('question-start', (event) => {
        handleQuestionStart(event.detail || event);
    });

    window.addEventListener('question-result', (event) => {
        handleQuestionResult(event.detail || event);
    });

    window.addEventListener('question-answer', (event) => {
        const detail = event.detail || event;
        if (detail?.questionId === activeQuestionId) {
            setConnectionText(`Respuesta recibida de ${detail.fromUserId || 'otro móvil'}`);
        }
    });

    window.addEventListener('signalingDisconnect', () => {
        setConnectionText('Desconectado');
    });

    window.addEventListener('beforeunload', () => {
        stopTimeoutTimer();
    });

    if (window.socket) {
        window.socket.on('connect', () => setConnectionText('Conectado')); 
        window.socket.on('disconnect', () => setConnectionText('Desconectado'));
    }

    showWaiting();
    setConnectionText('Listo');
})();