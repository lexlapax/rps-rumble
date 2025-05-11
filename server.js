const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // Allow all origins for simplicity, restrict in production
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let queue = []; // { id: socket.id, nickname: 'PlayerX', answers: [...] }
let activeGames = {}; // roomId: { player1: {id, nickname, choice, score}, player2: {id, nickname, choice, score}, round, spectators: [socket.id] }
const MAX_ROUNDS = 3; // Best of 3

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    broadcastSystemUpdate(); // Send initial state to newly connected client

    socket.on('joinQueue', (data) => {
        if (!data.nickname || data.nickname.trim() === "") {
            socket.emit('error', { message: "Nickname cannot be empty!" });
            return;
        }
        // Prevent duplicate entries if user refreshes or something
        if (queue.find(p => p.id === socket.id) || Object.values(activeGames).find(g => g && (g.player1.id === socket.id || g.player2.id === socket.id))) {
            console.log(`Player ${socket.id} (${data.nickname}) tried to join queue again while already in queue/game.`);
            // Optionally, resend current game state if they are in a game
            for (const roomId in activeGames) {
                const game = activeGames[roomId];
                if (game && (game.player1.id === socket.id || game.player2.id === socket.id)) {
                    const isPlayer1 = game.player1.id === socket.id;
                    const opponent = isPlayer1 ? game.player2 : game.player1;
                    socket.emit('matchFound', {
                        roomId,
                        opponent: { nickname: opponent.nickname, id: opponent.id },
                        score: { you: isPlayer1 ? game.player1.score : game.player2.score, opponent: isPlayer1 ? game.player2.score : game.player1.score },
                        isReconnect: true // Flag to tell client it's a rejoin
                    });
                    return;
                }
            }
            return;
        }
        
        console.log(`${data.nickname} (${socket.id}) joined the queue with answers:`, data.answers);
        queue.push({ id: socket.id, nickname: data.nickname, answers: data.answers });
        tryMatchmaking();
        broadcastSystemUpdate();
    });

    socket.on('makeChoice', (data) => {
        const game = activeGames[data.roomId];
        if (!game) {
            console.error(`Game not found for roomId: ${data.roomId} from socket: ${socket.id}`);
            socket.emit('error', { message: "Game not found. Something went wrong!" });
            return;
        }

        const playerKey = game.player1.id === socket.id ? 'player1' : 'player2';
        if (game[playerKey].choice) {
             console.log(`Player ${game[playerKey].nickname} tried to choose again.`);
             return; // Already made a choice this round
        }

        game[playerKey].choice = data.choice;
        console.log(`Player ${game[playerKey].nickname} in room ${data.roomId} chose ${data.choice}`);

        const opponentKey = playerKey === 'player1' ? 'player2' : 'player1';
        io.to(game[opponentKey].id).emit('opponentMadeChoice');

        if (game.player1.choice && game.player2.choice) {
            processRound(data.roomId);
        } else {
            io.to(socket.id).emit('waitingForOpponent');
        }
    });

    socket.on('spectateGame', (roomId) => {
        const game = activeGames[roomId];
        if (game) {
            socket.join(roomId + "_spectators"); // Join a specific spectator room
            game.spectators = game.spectators || [];
            if (!game.spectators.includes(socket.id)) {
                game.spectators.push(socket.id);
            }
            console.log(`Socket ${socket.id} is now spectating game ${roomId}`);
            
            const currentScoreP1 = game.player1.score || 0;
            const currentScoreP2 = game.player2.score || 0;

            // Send current game state to new spectator
            // Only send choices if they are already revealed (e.g., if a round just finished)
            io.to(socket.id).emit('spectateGameUpdate', {
                roomId,
                player1: { name: game.player1.nickname, choice: null }, // Don't reveal choices yet
                player2: { name: game.player2.nickname, choice: null },
                scoreP1: currentScoreP1,
                scoreP2: currentScoreP2,
                round: game.round,
                message: game.player1.choice && game.player2.choice ? "Round in progress, choices made..." : "Waiting for players to choose..."
            });
        } else {
            socket.emit('error', { message: "Game not found to spectate." });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        queue = queue.filter(player => player.id !== socket.id);

        let gameToEnd = null;
        let disconnectedPlayerRoomId = null;

        for (const roomId in activeGames) {
            const game = activeGames[roomId];
            if (!game) continue;

            if (game.player1.id === socket.id || game.player2.id === socket.id) {
                const opponentId = game.player1.id === socket.id ? game.player2.id : game.player1.id;
                if (io.sockets.sockets.get(opponentId)) { // Check if opponent is still connected
                    io.to(opponentId).emit('opponentDisconnected', {
                        message: `${game.player1.id === socket.id ? game.player1.nickname : game.player2.nickname} disconnected. You win by default!`
                    });
                }
                gameToEnd = roomId;
                disconnectedPlayerRoomId = roomId; // Used to notify spectators
                break;
            }
            if (game.spectators) {
                game.spectators = game.spectators.filter(id => id !== socket.id);
            }
        }

        if (gameToEnd) {
            console.log(`Game ${gameToEnd} ended due to ${socket.id} disconnection.`);
            // Notify spectators of the specific game
            io.to(gameToEnd + "_spectators").emit('spectateGameUpdate', {
                message: `A player disconnected. Game ${gameToEnd} has ended.`,
                isGameOver: true
            });
            delete activeGames[gameToEnd];
        }
        broadcastSystemUpdate();
    });
});

function tryMatchmaking() {
    if (queue.length >= 2) {
        const player1Data = queue.shift();
        const player2Data = queue.shift();

        const roomId = `game_${player1Data.id}_${player2Data.id}_${Date.now()}`;

        activeGames[roomId] = {
            player1: { id: player1Data.id, nickname: player1Data.nickname, choice: null, score: 0 },
            player2: { id: player2Data.id, nickname: player2Data.nickname, choice: null, score: 0 },
            round: 1,
            spectators: []
        };

        io.sockets.sockets.get(player1Data.id)?.join(roomId);
        io.sockets.sockets.get(player2Data.id)?.join(roomId);

        console.log(`Match found! Room: ${roomId}, ${player1Data.nickname} vs ${player2Data.nickname}`);

        io.to(player1Data.id).emit('matchFound', {
            roomId,
            opponent: { nickname: player2Data.nickname, id: player2Data.id },
            score: { you: 0, opponent: 0 }
        });
        io.to(player2Data.id).emit('matchFound', {
            roomId,
            opponent: { nickname: player1Data.nickname, id: player1Data.id },
            score: { you: 0, opponent: 0 }
        });
        broadcastSystemUpdate();
    }
}

function determineWinner(choice1, choice2) {
    if (choice1 === choice2) return null; // Tie
    if (
        (choice1 === 'rock' && choice2 === 'scissors') ||
        (choice1 === 'scissors' && choice2 === 'paper') ||
        (choice1 === 'paper' && choice2 === 'rock')
    ) {
        return 'player1';
    }
    return 'player2';
}

function processRound(roomId) {
    const game = activeGames[roomId];
    if (!game || !game.player1.choice || !game.player2.choice) {
        console.error("ProcessRound called prematurely for room:", roomId, game);
        return;
    }

    const p1Choice = game.player1.choice;
    const p2Choice = game.player2.choice;
    const winnerKey = determineWinner(p1Choice, p2Choice);

    let roundMessage = "";
    let roundWinnerId = null;

    if (winnerKey === 'player1') {
        game.player1.score++;
        roundMessage = `${game.player1.nickname}'s mighty ${p1Choice} CRUSHES ${game.player2.nickname}'s feeble ${p2Choice}!`;
        roundWinnerId = game.player1.id;
    } else if (winnerKey === 'player2') {
        game.player2.score++;
        roundMessage = `${game.player2.nickname}'s cunning ${p2Choice} OUTSMARTS ${game.player1.nickname}'s predictable ${p1Choice}!`;
        roundWinnerId = game.player2.id;
    } else {
        roundMessage = `A TENSE DRAW! Both gladiators chose ${p1Choice}. The crowd holds its breath!`;
    }

    let isGameOver = false;
    let finalMessage = roundMessage; // Start with round message

    // Check for game over condition (best of MAX_ROUNDS)
    const scoreToWin = Math.ceil(MAX_ROUNDS / 2);
    if (game.player1.score >= scoreToWin || game.player2.score >= scoreToWin || game.round >= MAX_ROUNDS) {
        isGameOver = true;
        if (game.player1.score > game.player2.score) {
            finalMessage = `${game.player1.nickname} is CROWNED THE RPS RUMBLE CHAMPION with ${game.player1.score} points to ${game.player2.score}!`;
            roundWinnerId = game.player1.id; // Overall winner
        } else if (game.player2.score > game.player1.score) {
            finalMessage = `${game.player2.nickname} TRIUMPHS as the RPS RUMBLE VICTOR with ${game.player2.score} points to ${game.player1.score}!`;
            roundWinnerId = game.player2.id; // Overall winner
        } else { // Could be a draw if rounds ended and scores are equal
            finalMessage = `AN EPIC STALEMATE! After ${MAX_ROUNDS} rounds, ${game.player1.nickname} and ${game.player2.nickname} are tied! The arena echoes with applause!`;
            roundWinnerId = null; // Overall game draw
        }
    }

    const roundResultData = {
        player1: { id: game.player1.id, choice: p1Choice, nickname: game.player1.nickname },
        player2: { id: game.player2.id, choice: p2Choice, nickname: game.player2.nickname },
        roundWinnerId, // ID of the round winner, or null for a tie
        message: finalMessage, // Use finalMessage which includes game over status
        score: { /* to be personalized */ },
        isGameOver,
        round: game.round
    };
    
    io.to(game.player1.id).emit('roundResult', {
        ...roundResultData,
        score: { you: game.player1.score, opponent: game.player2.score }
    });
    io.to(game.player2.id).emit('roundResult', {
        ...roundResultData,
        score: { you: game.player2.score, opponent: game.player1.score }
    });
    
    // Spectator update
    io.to(roomId + "_spectators").emit('spectateGameUpdate', {
        roomId,
        player1: { name: game.player1.nickname, choice: p1Choice },
        player2: { name: game.player2.nickname, choice: p2Choice },
        message: finalMessage,
        scoreP1: game.player1.score,
        scoreP2: game.player2.score,
        isGameOver,
        round: game.round
    });

    if (isGameOver) {
        console.log(`Game ${roomId} ended. Winner: ${roundWinnerId ? (activeGames[roomId][winnerKey === 'player1' ? 'player1' : 'player2']?.nickname || 'Draw') : 'Draw'}`);
        io.sockets.sockets.get(game.player1.id)?.leave(roomId);
        io.sockets.sockets.get(game.player2.id)?.leave(roomId);
        if (game.spectators) {
            game.spectators.forEach(specId => io.sockets.sockets.get(specId)?.leave(roomId + "_spectators"));
        }
        delete activeGames[roomId];
        broadcastSystemUpdate();
    } else {
        game.round++;
        game.player1.choice = null;
        game.player2.choice = null;
    }
}

function broadcastSystemUpdate() {
    const publicActiveGames = Object.entries(activeGames).map(([roomId, game]) => {
        if (!game || !game.player1 || !game.player2) return null; // Defensive check
        return {
            roomId,
            player1Name: game.player1.nickname,
            player2Name: game.player2.nickname
        };
    }).filter(g => g !== null);

    const publicQueue = queue.map(p => ({ id: p.id, nickname: p.nickname }));

    io.emit('queueUpdate', {
        queue: publicQueue,
        activeGames: publicActiveGames
    });
}

server.listen(PORT, () => {
    console.log(`RPS Rumble Arena is roaring on port ${PORT}`);
});

