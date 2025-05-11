document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const sections = {
        join: document.getElementById('join-section'),
        waiting: document.getElementById('waiting-section'),
        game: document.getElementById('game-section'),
        spectator: document.getElementById('spectator-section')
    };

    // Join Page
    const nicknameInput = document.getElementById('nickname');
    const question1Input = document.getElementById('question1');
    const question2Input = document.getElementById('question2');
    const joinButton = document.getElementById('join-arena-btn');
    const joinErrorText = document.getElementById('join-error');

    // Waiting Room
    const queueStatusText = document.getElementById('queue-status');
    const queueList = document.getElementById('queue-list');
    const activeGamesList = document.getElementById('active-games-list');

    // Game Arena (Player)
    const playerVsOpponentText = document.getElementById('player-vs-opponent');
    const currentRoundText = document.getElementById('current-round');
    const scoreText = document.getElementById('score');
    const gameStatusText = document.getElementById('game-status');
    const rockButton = document.getElementById('rock-btn');
    const paperButton = document.getElementById('paper-btn');
    const scissorsButton = document.getElementById('scissors-btn');
    const choiceButtons = [rockButton, paperButton, scissorsButton];
    const playerChoiceDisplay = document.getElementById('player-choice-display');
    const opponentChoiceDisplay = document.getElementById('opponent-choice-display');
    const myPlayerNameDisplay = document.getElementById('my-player-name-display');
    const opponentNameDisplay = document.getElementById('opponent-name-display');
    const roundResultText = document.getElementById('round-result');
    const gameOverControls = document.getElementById('game-over-controls');
    const playAgainButton = document.getElementById('play-again-btn');
    const backToLoungeButton = document.getElementById('back-to-lounge-btn');
    const countdownDisplay = document.getElementById('countdown-display');

    // Spectator View
    const spectateGameTitle = document.getElementById('spectate-game-title');
    const spectateRoundText = document.getElementById('spectate-current-round');
    const spectateScoreText = document.getElementById('spectate-score');
    const spectatePlayer1Name = document.getElementById('spectate-player1-name');
    const spectatePlayer1Choice = document.getElementById('spectate-player1-choice');
    const spectatePlayer2Name = document.getElementById('spectate-player2-name');
    const spectatePlayer2Choice = document.getElementById('spectate-player2-choice');
    const spectateGameStatus = document.getElementById('spectate-game-status');
    const spectateRoundResult = document.getElementById('spectate-round-result');
    const exitSpectateButton = document.getElementById('exit-spectate-btn');

    const confettiContainer = document.getElementById('confetti-container');
    document.getElementById('current-year').textContent = new Date().getFullYear();


    // --- Socket.IO Connection ---
    const socket = io(); 

    let myPlayerId = null;
    let currentRoomId = null;
    let myNickname = '';
    let opponentNickname = '';
    let currentSpectatedRoomId = null;

    const MAX_ROUNDS_CONST = 3; // Should match server

    // --- Utility Functions ---
    function setActiveSection(sectionName) {
        Object.values(sections).forEach(section => section.classList.remove('active-section'));
        if (sections[sectionName]) {
            sections[sectionName].classList.add('active-section');
        }
        // Reset any game-specific states if not going to game/spectator
        if (sectionName !== 'game' && sectionName !== 'spectator') {
            currentRoomId = null;
            currentSpectatedRoomId = null;
            resetGameUI();
            resetSpectatorUI();
        }
    }
    
    function displayChoice(element, choice) {
        element.classList.remove('placeholder');
        element.innerHTML = `<img src="/images/${choice}.svg" alt="${choice}" class="choice-image">`;
        element.classList.add('revealed');
        // Trigger reflow for animation restart
        void element.offsetWidth; 
        element.classList.add('revealed'); 
    }

    function resetChoiceDisplay(element) {
        element.classList.add('placeholder');
        element.classList.remove('revealed');
        element.innerHTML = `<span class="question-mark">?</span>`;
    }
    
    function resetGameUI() {
        playerVsOpponentText.textContent = "YOU vs. OPPONENT";
        currentRoundText.textContent = `Round: 1/${MAX_ROUNDS_CONST}`;
        scoreText.textContent = "Score: You 0 - 0 Opponent";
        gameStatusText.textContent = "CHOOSE YOUR WEAPON OF DESTINY!";
        resetChoiceDisplay(playerChoiceDisplay);
        resetChoiceDisplay(opponentChoiceDisplay);
        roundResultText.textContent = "";
        roundResultText.className = 'result-display'; // Reset result classes
        gameOverControls.style.display = 'none';
        countdownDisplay.textContent = "";
        enableChoiceButtons();
    }

    function resetSpectatorUI() {
        spectateGameTitle.textContent = "SPECTATING: Player A vs. Player B";
        spectateRoundText.textContent = `Round: 1/${MAX_ROUNDS_CONST}`;
        spectateScoreText.textContent = "Score: P1 0 - 0 P2";
        resetChoiceDisplay(spectatePlayer1Choice);
        resetChoiceDisplay(spectatePlayer2Choice);
        spectatePlayer1Name.textContent = "Player 1";
        spectatePlayer2Name.textContent = "Player 2";
        spectateGameStatus.textContent = "Watching the titans clash!";
        spectateRoundResult.textContent = "";
        spectateRoundResult.className = 'result-display';
    }

    function triggerConfetti() {
        confettiContainer.innerHTML = ''; // Clear old confetti
        for (let i = 0; i < 100; i++) {
            const confetti = document.createElement('div');
            confetti.classList.add('confetti');
            confetti.classList.add(`shape${Math.ceil(Math.random() * 2)}`);
            confetti.classList.add(`color${Math.ceil(Math.random() * 3)}`);
            confetti.style.left = `${Math.random() * 100}vw`;
            confetti.style.animationDelay = `${Math.random() * 2}s`;
            confetti.style.transform = `scale(${Math.random() * 0.5 + 0.5})`; // Vary size
            confettiContainer.appendChild(confetti);
        }
    }


    // --- Event Listeners ---
    joinButton.addEventListener('click', () => {
        myNickname = nicknameInput.value.trim();
        const answers = [
            question1Input.value,
            question2Input.value.trim()
        ];
        joinErrorText.textContent = "";
        if (myNickname) {
            socket.emit('joinQueue', { nickname: myNickname, answers });
            setActiveSection('waiting');
            queueStatusText.textContent = "Joining the queue... get ready to rumble!";
        } else {
            joinErrorText.textContent = "Please enter a Challenger Name, oh brave one!";
        }
    });

    choiceButtons.forEach(button => {
        button.addEventListener('click', () => {
            if (currentRoomId) {
                const choice = button.dataset.choice;
                socket.emit('makeChoice', { roomId: currentRoomId, choice });
                gameStatusText.textContent = `You chose ${choice.toUpperCase()}! The tension is palpable...`;
                displayChoice(playerChoiceDisplay, choice); // Show own choice immediately
                disableChoiceButtons();
            }
        });
    });

    playAgainButton.addEventListener('click', () => {
        socket.emit('joinQueue', { nickname: myNickname, answers: [question1Input.value, question2Input.value.trim()] });
        setActiveSection('waiting');
        queueStatusText.textContent = "Re-joining the queue for more glorious combat!";
        resetGameUI();
    });

    backToLoungeButton.addEventListener('click', () => {
        setActiveSection('waiting');
        resetGameUI();
        // No need to rejoin queue, just viewing
    });
    
    exitSpectateButton.addEventListener('click', () => {
        if (currentSpectatedRoomId) {
            // Optional: notify server leaving spectate if server tracks it per socket for that room
            // socket.emit('leaveSpectate', currentSpectatedRoomId);
        }
        setActiveSection('waiting');
        resetSpectatorUI();
    });


    function disableChoiceButtons() {
        choiceButtons.forEach(btn => btn.classList.add('disabled'));
    }

    function enableChoiceButtons() {
        choiceButtons.forEach(btn => btn.classList.remove('disabled'));
    }

    // --- Socket Event Handlers ---
    socket.on('connect', () => {
        myPlayerId = socket.id;
        console.log('Connected to server with ID:', myPlayerId);
        // If returning to page and was in a game, server might resend matchFound
    });

    socket.on('queueUpdate', (data) => {
        // Update Queue List
        queueList.innerHTML = ""; // Clear previous list
        if (data.queue.length === 0) {
            const li = document.createElement('li');
            li.textContent = "The queue is eerily empty... be the first hero!";
            queueList.appendChild(li);
        } else {
            data.queue.forEach((player, index) => {
                const li = document.createElement('li');
                li.textContent = `${index + 1}. ${player.nickname}`;
                if (player.id === myPlayerId) {
                    li.classList.add('is-self');
                    li.textContent += " (That's You!)";
                    queueStatusText.textContent = `Sharpening your wits... You are #${index + 1} in the queue!`;
                }
                queueList.appendChild(li);
            });
        }
        if (!data.queue.some(p => p.id === myPlayerId) && sections.waiting.classList.contains('active-section') && !currentRoomId) {
             // If I'm in waiting but not in queue (e.g. after game), default message
            queueStatusText.textContent = "Waiting for your next challenge or spectate a game!";
        }


        // Update Active Games List
        activeGamesList.innerHTML = ""; // Clear previous list
        if (data.activeGames.length === 0) {
            const li = document.createElement('li');
            li.textContent = "No matches currently live. The arena awaits action!";
            activeGamesList.appendChild(li);
        } else {
            data.activeGames.forEach(game => {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.href = "#";
                a.textContent = `SPECTATE: ${game.player1Name} vs. ${game.player2Name}`;
                a.dataset.roomId = game.roomId;
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    socket.emit('spectateGame', game.roomId);
                    currentSpectatedRoomId = game.roomId;
                });
                li.appendChild(a);
                activeGamesList.appendChild(li);
            });
        }
    });

    socket.on('matchFound', (data) => {
        currentRoomId = data.roomId;
        opponentNickname = data.opponent.nickname;
        setActiveSection('game');
        resetGameUI(); // Ensure clean state

        playerVsOpponentText.textContent = `YOU (${myNickname}) vs. ${opponentNickname}`;
        myPlayerNameDisplay.textContent = `${myNickname}'s Mighty Hand`;
        opponentNameDisplay.textContent = `${opponentNickname}'s Fateful Fist`;
        scoreText.textContent = `Score: You ${data.score.you} - ${data.score.opponent} ${opponentNickname}`;
        currentRoundText.textContent = `Round: 1/${MAX_ROUNDS_CONST}`;
        gameStatusText.textContent = "MATCH FOUND! Prepare for GLORIOUS BATTLE!";
        enableChoiceButtons();
    });

    socket.on('waitingForOpponent', () => {
        gameStatusText.textContent = "Waiting for your opponent's cunning move...";
    });
    
    socket.on('opponentMadeChoice', () => {
        // Only update if I haven't chosen yet
        if (!choiceButtons.some(b => b.classList.contains('disabled'))) {
            gameStatusText.textContent = `Your opponent has chosen! The gauntlet is thrown! Your move, ${myNickname}!`;
        }
    });

    socket.on('roundResult', (data) => {
        gameStatusText.textContent = "REVEALING CHOICES... STAND BY!";
        countdownDisplay.textContent = "3";
        
        setTimeout(() => { countdownDisplay.textContent = "2"; }, 700);
        setTimeout(() => { countdownDisplay.textContent = "1"; }, 1400);
        setTimeout(() => {
            countdownDisplay.textContent = "REVEAL!";
            
            // Determine my choice and opponent's choice from perspective
            const myActualChoice = data.player1.id === myPlayerId ? data.player1.choice : data.player2.choice;
            const opponentActualChoice = data.player1.id === myPlayerId ? data.player2.choice : data.player1.choice;
            
            displayChoice(playerChoiceDisplay, myActualChoice);
            displayChoice(opponentChoiceDisplay, opponentActualChoice);

            setTimeout(() => { // Short delay after reveal before showing result text
                roundResultText.textContent = data.message;
                roundResultText.className = 'result-display'; // Reset classes
                if (data.roundWinnerId === myPlayerId) {
                    roundResultText.classList.add('win');
                    if (data.isGameOver) triggerConfetti(); // Confetti on final win
                } else if (data.roundWinnerId === null) {
                    roundResultText.classList.add('tie');
                } else if (data.roundWinnerId) { // Opponent won
                    roundResultText.classList.add('lose');
                }


                scoreText.textContent = `Score: You ${data.score.you} - ${data.score.opponent} ${opponentNickname}`;
                currentRoundText.textContent = `Round: ${data.round}/${MAX_ROUNDS_CONST}`;


                if (data.isGameOver) {
                    gameStatusText.textContent = data.roundWinnerId === myPlayerId ? "YOU ARE THE GRAND CHAMPION!" : (data.roundWinnerId === null ? "AN EPIC DRAW! WELL FOUGHT!" : "A TOUGH BATTLE, BUT VALIANTLY FOUGHT!");
                    disableChoiceButtons();
                    gameOverControls.style.display = 'flex';
                } else {
                    gameStatusText.textContent = "Next round! Choose wisely, the fate of the arena rests on your hands!";
                    enableChoiceButtons();
                    // Reset choice displays for next round after a brief pause
                    setTimeout(() => {
                        if (!data.isGameOver) { // Double check game not over
                           resetChoiceDisplay(playerChoiceDisplay);
                           resetChoiceDisplay(opponentChoiceDisplay);
                           countdownDisplay.textContent = "";
                        }
                    }, 2000);
                }
            }, 500); // Delay for result text

        }, 2100); // Total reveal sequence
    });

    socket.on('opponentDisconnected', (data) => {
        if (sections.game.classList.contains('active-section') && currentRoomId) {
            gameStatusText.textContent = data.message || "Your opponent disconnected! You win by default (less glorious, but a win is a win)!";
            roundResultText.textContent = "Victory by Forfeit!";
            roundResultText.className = 'result-display win';
            disableChoiceButtons();
            gameOverControls.style.display = 'flex';
            triggerConfetti(); // Still celebrate!
            currentRoomId = null; // Clear current game
        }
    });
    
    socket.on('spectateGameUpdate', (data) => {
        if (currentSpectatedRoomId === data.roomId || (currentSpectatedRoomId && !data.roomId)) { // Handle initial join or update
            setActiveSection('spectator');
            
            spectateGameTitle.textContent = `SPECTATING: ${data.player1.name} vs. ${data.player2.name}`;
            spectatePlayer1Name.textContent = data.player1.name;
            spectatePlayer2Name.textContent = data.player2.name;
            spectateScoreText.textContent = `Score: ${data.player1.name} ${data.scoreP1} - ${data.scoreP2} ${data.player2.name}`;
            spectateRoundText.textContent = `Round: ${data.round || 1}/${MAX_ROUNDS_CONST}`;

            if(data.player1.choice) displayChoice(spectatePlayer1Choice, data.player1.choice); else resetChoiceDisplay(spectatePlayer1Choice);
            if(data.player2.choice) displayChoice(spectatePlayer2Choice, data.player2.choice); else resetChoiceDisplay(spectatePlayer2Choice);
            
            spectateGameStatus.textContent = data.message || "Watching the game unfold...";
            spectateRoundResult.textContent = data.message; // Server sends consolidated message
            spectateRoundResult.className = 'result-display';

            if (data.message && data.message.toLowerCase().includes(data.player1.name + " wins") || data.message.toLowerCase().includes(data.player1.name + " is crowned")) {
                spectateRoundResult.classList.add('win'); // From P1's perspective
            } else if (data.message && data.message.toLowerCase().includes(data.player2.name + " wins") || data.message.toLowerCase().includes(data.player2.name + " triumphs")) {
                spectateRoundResult.classList.add('lose'); // From P1's perspective (P2 wins)
            } else if (data.message && (data.message.toLowerCase().includes("draw") || data.message.toLowerCase().includes("stalemate"))) {
                spectateRoundResult.classList.add('tie');
            }


            if (data.isGameOver) {
                spectateGameStatus.textContent = "The match has concluded! " + data.message;
                 // No play again for spectators, just exit button
            }
        }
    });

    socket.on('error', (data) => {
        console.error("Server Error:", data.message);
        if (sections.join.classList.contains('active-section')) {
            joinErrorText.textContent = `Oops! ${data.message}`;
        } else {
            // A more generic error display might be needed if not on join screen
            alert(`Server error: ${data.message}`);
        }
    });


    // Initialize
    setActiveSection('join');
});

