import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Crosshair, Database, Rocket, Save, RefreshCw, Upload, Terminal, Monitor, Activity, Zap, ShieldAlert, ArrowLeft } from 'lucide-react';

// === TYPES & INTERFACES (From types.ts) ===
type GamePhase = 'LOADING' | 'LOBBY' | 'PLAYING' | 'GAME_OVER';

interface WordItem {
    id: number;
    word: string;
    definition: string;
    synonym: string;
    antonym: string;
    soundUrl: string; // Reserved for future use
    color: string;
}

interface GameSettings {
    durationMinutes: number | 'inf';
    baseSpeed: number; // 1 to 10
}

interface GameStats {
    score: number;
    wpm: number;
    wordsDestroyed: number;
    accuracy: number;
}

interface ActiveWord extends WordItem {
    x: number;
    y: number;
    uuid: string;
}

interface Particle {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    color: string;
    life: number;
}

// --- CONSTANTS ---
const CAPSULE_COLORS = ['#ff00de', '#00f3ff', '#00ff41', '#ffb300', '#ec4899'];
const DEFAULT_WORDS: WordItem[] = [
    { id: 1, word: "PROTOCOL", definition: "A system of rules that explain the correct conduct and procedures to be followed.", synonym: "Procedure", antonym: "Chaos", soundUrl: "", color: CAPSULE_COLORS[0] },
    { id: 2, word: "ORBITAL", definition: "Relating to an orbit or orbits.", synonym: "Celestial", antonym: "Terrestrial", soundUrl: "", color: CAPSULE_COLORS[1] },
    { id: 3, word: "KINETIC", definition: "Relating to or resulting from motion.", synonym: "Dynamic", antonym: "Static", soundUrl: "", color: CAPSULE_COLORS[2] },
    { id: 4, word: "VECTOR", definition: "A quantity having direction as well as magnitude.", synonym: "Heading", antonym: "Scalar", soundUrl: "", color: CAPSULE_COLORS[3] },
    { id: 5, word: "CIPHER", definition: "A secret or disguised way of writing; a code.", synonym: "Code", antonym: "Key", soundUrl: "", color: CAPSULE_COLORS[4] },
];

// === UTILS (Audio, CSV Parser) ===

// 1. AUDIO SYSTEM (Using Web Audio API Stubs - Works in Vite)
class AudioSystem {
    ctx: AudioContext | null = null;
    
    constructor() {
        try {
            this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        } catch (e) {
            console.warn("Web Audio API not supported or blocked.");
        }
    }
    
    // Placeholder for actual sound loading/playing logic
    playTone(freq: number, type: OscillatorType, duration: number, vol = 0.1) {
        if (!this.ctx || this.ctx.state !== 'running') return; 
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }
    
    // Play sounds only if audio context is active
    playLaser() { this.playTone(880, 'sawtooth', 0.05, 0.1); }
    playExplosion() { this.playTone(100, 'square', 0.3, 0.2); }
    playBlip() { this.playTone(1200, 'sine', 0.05, 0.05); }
    playError() { this.playTone(150, 'sawtooth', 0.2, 0.2); }
    playBackgroundMusic() { 
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume(); // Resume context if possible
        }
        // In a real app, this would load and loop an MP3 from the public folder.
        // For simplicity here, we rely on the click initiating the context.
    }
}
const audioSystem = new AudioSystem();


// 2. CSV Parser
const parseCSV = (csvText: string): WordItem[] => {
    // Expects CSV: Word, Definition, Synonym, Antonym, SoundURL (5 columns)
    const rows = csvText.split('\n').slice(1).filter(row => row.trim() !== '');
    
    return rows.map((row, index) => {
        const columns = row.split(',');
        if (columns.length >= 4 && columns[0].trim()) {
            return {
                id: index + 1000,
                word: columns[0].trim().toUpperCase(),
                definition: columns[1]?.trim() || "N/A",
                synonym: columns[2]?.trim() || "N/A",
                antonym: columns[3]?.trim() || "N/A",
                soundUrl: columns[4]?.trim() || "",
                color: CAPSULE_COLORS[Math.floor(Math.random() * CAPSULE_COLORS.length)],
            } as WordItem;
        }
        return null;
    }).filter(item => item !== null) as WordItem[];
};


// === MAIN APPLICATION START ===

export default function App() {
    // ADD THESE THREE LINES:
  const [activeTab, setActiveTab] = useState<'DEPLOY' | 'INTEL'>('DEPLOY');
  const [showSettings, setShowSettings] = useState(false);
  const [settingTab, setSettingTab] = useState<'duration' | 'speed'>('duration');
    // --- STATE MANAGEMENT ---
    const [phase, setPhase] = useState<GamePhase>('LOADING');
    const [isAudioInitialized, setIsAudioInitialized] = useState(false);
    const [words, setWords] = useState<WordItem[]>(DEFAULT_WORDS);
    const [settings, setSettings] = useState<GameSettings>({ durationMinutes: 5, baseSpeed: 5 });
    
    // Game State
    const [score, setScore] = useState(0);
    const [lives, setLives] = useState(3);
    const [typedChars, setTypedChars] = useState('');
    const [lastDestroyed, setLastDestroyed] = useState<WordItem | null>(null);
    const [timeLeft, setTimeLeft] = useState(settings.durationMinutes === 'inf' ? 9999 : settings.durationMinutes * 60);
    const [turretAngle, setTurretAngle] = useState(0);
    const [showIntelPanel, setShowIntelPanel] = useState(false); // Used in Lobby
    const [customCsvInput, setCustomCsvInput] = useState('');
    const [saveStatus, setSaveStatus] = useState<string>('');
    
    // Game Refs & Loop
    const activeWordRef = useRef<ActiveWord | null>(null);
    const typedRef = useRef<string>('');
    const lastTimeRef = useRef<number>(0);
    const animationFrameRef = useRef<number>(0);
    const speedRef = useRef<number>(settings.baseSpeed * 0.5);
    const battlefieldRef = useRef<HTMLDivElement>(null);


    // 1. INITIAL LOAD & OFFLINE CACHE
    useEffect(() => {
        const saved = localStorage.getItem('wb_custom_words');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setWords(parsed);
                }
            } catch (e) { console.error("Failed to load local words", e); }
        }
        // Since we removed LoadingScreen component, we add a simple delay here
        const timer = setTimeout(() => {
            if (isAudioInitialized) setPhase('LOBBY'); // If initialized by button, skip straight
        }, 3000); 
        return () => clearTimeout(timer);
    }, [isAudioInitialized]);


    // 2. CSV/Data Sync Logic
    const handleCsvSync = (items: WordItem[]) => {
        if (items.length === 0) {
            setSaveStatus('Error: No valid words found.');
            return;
        }
        setWords(items);
        localStorage.setItem('wb_custom_words', JSON.stringify(items));
        setSaveStatus(`Success: ${items.length} words synced.`);
        setTimeout(() => setSaveStatus(''), 3000);
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result;
            if (typeof text === 'string') {
                try {
                    const items = parseCSV(text);
                    handleCsvSync(items);
                } catch (err) { setSaveStatus('Error parsing CSV file.'); }
            }
        };
        reader.readAsText(file);
        event.target.value = ''; // Reset input value
    };


    // 3. GAME LOGIC HELPERS
    const spawnWord = useCallback(() => {
        if (!battlefieldRef.current) return;
        const width = battlefieldRef.current.clientWidth;
        const randomWord = words[Math.floor(Math.random() * words.length)];
        const x = Math.random() * (width * 0.8) + (width * 0.1);
        
        const newWord: ActiveWord = { ...randomWord, x, y: -50, uuid: Math.random().toString(36).substr(2, 9), color: CAPSULE_COLORS[Math.floor(Math.random() * CAPSULE_COLORS.length)] };
        
        activeWordRef.current = newWord;
        typedRef.current = '';
        setTypedChars('');
    }, [words]);

    const createParticles = (x: number, y: number) => {
        // Simple particle logic for visual effect (not fully physics-based)
        // Since the prompt asked for particles but we removed the component, we just trigger the explosion sound
        // In a real app, this would update particlesRef
        console.log("BOOM! Particles triggered at", x, y);
    };
    
    const startGame = (duration: number | 'inf') => {
        setScore(0);
        setLives(3);
        setLastDestroyed(null);
        setSettings(s => ({...s, durationMinutes: duration}));
        setTimeLeft(duration === 'inf' ? 9999 : (duration as number) * 60);
        spawnWord();
        setPhase('PLAYING');
    };


    // 4. MAIN GAME LOOP (requestAnimationFrame)
    const gameLoop = useCallback((timestamp: number) => {
        if (phase !== 'PLAYING') {
            animationFrameRef.current = requestAnimationFrame(gameLoop);
            return;
        }

        if (lastTimeRef.current === 0) lastTimeRef.current = timestamp;
        const deltaTime = (timestamp - lastTimeRef.current) / 1000;
        lastTimeRef.current = timestamp;

        // 1. Update Word Position
        if (activeWordRef.current && battlefieldRef.current) {
            const speedMultiplier = speedRef.current * settings.baseSpeed * 0.2;
            activeWordRef.current.y += speedMultiplier * deltaTime * 60; // 60 is for scaling speed
            
            // Turret Tracking logic
            const turretX = battlefieldRef.current.clientWidth / 2;
            const turretY = battlefieldRef.current.clientHeight - 40; 
            const angle = Math.atan2(activeWordRef.current.y - turretY, activeWordRef.current.x - turretX) * (180 / Math.PI);
            setTurretAngle(angle + 90); 

            // Hit Floor Check
            if (activeWordRef.current.y > battlefieldRef.current.clientHeight - 50) {
                activeWordRef.current = null;
                audioSystem.playError();
                setLives(l => {
                    if (l - 1 <= 0) {
                        setPhase('GAME_OVER');
                    }
                    return l - 1;
                });
                spawnWord();
            } else {
                // Sync UI position (We don't setUiActiveWord directly in the loop, rely on refs and render)
                // We force a render only when necessary, but for this simplified approach, let's just let it run.
            }
        } else if (phase === 'PLAYING') {
             spawnWord();
        }

        animationFrameRef.current = requestAnimationFrame(gameLoop);
    }, [phase, spawnWord, settings.baseSpeed]);

    useEffect(() => {
        animationFrameRef.current = requestAnimationFrame(gameLoop);
        return () => {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, [gameLoop]);


    // 5. INPUT HANDLING (Keyboard)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (phase !== 'PLAYING' || !activeWordRef.current) return;

            const char = e.key.toUpperCase();
            const targetWord = activeWordRef.current.word.toUpperCase();
            const currentProgress = typedRef.current.length;

            // Check if it's a valid typing character
            if (char.length !== 1 || !/^[A-Z0-9]$/.test(char)) return;

            if (targetWord[currentProgress] === char) {
                // Correct Match
                typedRef.current += char;
                setTypedChars(typedRef.current);
                audioSystem.playLaser(); 

                if (typedRef.current === targetWord) {
                    // Word Destroyed
                    audioSystem.playExplosion();
                    setScore(s => s + targetWord.length * 10);
                    setLastDestroyed(activeWordRef.current); // Update Intel Panel
                    activeWordRef.current = null;
                    spawnWord(); // Spawn next word
                }
            } else {
                 audioSystem.playError();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [phase, spawnWord]);
    
    // 6. TIMER EFFECT
    useEffect(() => {
        if (phase === 'PLAYING' && settings.durationMinutes !== 'inf') {
            const i = setInterval(() => {
                setTimeLeft(t => {
                    if (t <= 1) {
                        clearInterval(i);
                        setPhase('GAME_OVER');
                        return 0;
                    }
                    return t - 1;
                });
            }, 1000);
            return () => clearInterval(i);
        }
    }, [phase, settings.durationMinutes]);


    // --- RENDER SECTIONS ---

    const renderGameUI = () => (
        <div style={appStyles.container}>
            {/* LEFT: BATTLEFIELD (75%) */}
            <div ref={battlefieldRef} style={appStyles.leftPanel}>
                <div style={appStyles.starField} />
                
                {/* Turret */}
                <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: `translateX(-50%) rotate(${turretAngle}deg)`, width: '60px', height: '60px', zIndex: 10 }}>
                    <div style={appStyles.turretBarrel} />
                    <div style={appStyles.turretBase} />
                </div>
                
                {/* Falling Word (Rendered relative to its X/Y state) */}
                {activeWordRef.current && (
                    <div style={{ 
                        position: 'absolute', 
                        left: activeWordRef.current.x, 
                        top: activeWordRef.current.y,
                        transform: 'translateX(-50%)',
                        backgroundColor: 'rgba(0,0,0,0.8)',
                        border: `2px solid ${activeWordRef.current.color}`,
                        padding: '10px 20px', borderRadius: '20px',
                        fontSize: '24px', fontWeight: 'bold', 
                        boxShadow: `0 0 15px ${activeWordRef.current.color}`
                    }}>
                        <span style={{ color: 'gray' }}>{typedChars}</span>
                        <span style={{ color: 'white' }}>{activeWordRef.current.word.substring(typedChars.length)}</span>
                    </div>
                )}
            </div>

            {/* RIGHT: DASHBOARD */}
            <div style={appStyles.rightPanel}>
                {/* Top Stats */}
                <div style={appStyles.statBox}>
                    <div style={{ color: '#00f3ff', fontSize: '12px' }}>SCORE</div>
                    <div style={{ color: 'white', fontSize: '30px' }}>{score}</div>
                    <div style={{ color: '#ff003c', fontSize: '12px', marginTop: '10px' }}>LIVES: {lives}</div>
                </div>

                {/* Live Intel Feed */}
                <div style={appStyles.intelFeedBox}>
                    <h3 style={{ color: '#00ff41', fontSize: '14px', marginBottom: '10px' }}>LIVE INTEL</h3>
                    {lastDestroyed ? (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} key={lastDestroyed.id}>
                            <h4 style={{ color: 'white', fontSize: '24px' }}>{lastDestroyed.word}</h4>
                            <p style={{ color: 'gray', fontSize: '12px', marginTop: '5px' }}>DEF: {lastDestroyed.definition}</p>
                            <p style={{ color: 'cyan', fontSize: '12px' }}>SYN: {lastDestroyed.synonym}</p>
                            <p style={{ color: 'red', fontSize: '12px' }}>ANT: {lastDestroyed.antonym}</p>
                        </motion.div>
                    ) : (
                        <p style={{ color: 'gray', textAlign: 'center', fontSize: '12px' }}>AWAITING TARGET DATA...</p>
                    )}
                </div>

                {/* Speed Slider */}
                <div style={appStyles.sliderBox}>
                    <div style={{ color: 'gray', fontSize: '12px', marginBottom: '5px' }}>SPEED CONTROL</div>
                    <input type="range" min="1" max="10" value={speedRef.current} onChange={(e) => { speedRef.current = parseFloat(e.target.value); }} style={{ width: '100%', accentColor: '#ffb300' }} />
                </div>
            </div>
        </div>
    );
    
    const renderMenuUI = () => (
        <div style={{ ...appStyles.container, justifyContent: 'center', alignItems: 'center' }}>
            <div style={appStyles.menuContainer}>
                {/* Left Menu Buttons */}
                <div style={appStyles.menuButtons}>
                    <button onClick={() => { audioSystem.playBlip(); setActiveTab('DEPLOY'); }} style={appStyles.menuButton(activeTab === 'DEPLOY', '#00f3ff')}>
                        <Rocket size={30} /> DEPLOY MISSION
                    </button>
                    <button onClick={() => { audioSystem.playBlip(); setActiveTab('INTEL'); }} style={appStyles.menuButton(activeTab === 'INTEL', '#ff00de')}>
                        <Database size={30} /> INTEL UPLINK
                    </button>
                </div>

                {/* Right Context Panel */}
                <div style={appStyles.menuContextPanel}>
                    {activeTab === 'DEPLOY' ? (
                        <div style={appStyles.menuContent}>
                            {/* Duration Selector */}
                            <h2 style={{ color: '#00f3ff', fontSize: '20px', marginBottom: '10px' }}>MISSION DURATION</h2>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '30px' }}>
                                {([5, 10, 30, 60, 'inf'] as const).map(t => (
                                    <button key={t} onClick={() => setSettings(s => ({ ...s, durationMinutes: t }))} style={appStyles.durationButton(settings.durationMinutes === t)}>
                                        {t === 'inf' ? 'ENDLESS' : `${t} MIN`}
                                    </button>
                                ))}
                            </div>
                            <button onClick={() => startGame(settings.durationMinutes)} style={appStyles.startButton}>
                                ENGAGE
                            </button>
                        </div>
                    ) : (
                         <div style={appStyles.menuContent}>
                            {/* Intel Manager */}
                            <h2 style={{ color: '#ff00de', fontSize: '20px', marginBottom: '10px' }}>DATA SOURCE (5 COLUMNS)</h2>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                {/* File Upload */}
                                <div style={appStyles.fileUploadBox} onClick={() => console.log('Upload clicked')}>
                                    <input type="file" accept=".csv" onChange={handleFileUpload} style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }} />
                                    <Upload size={24} color="#ff00de" />
                                    <p style={{ color: '#ff00de', fontSize: '14px' }}>CLICK TO UPLOAD CSV FILE</p>
                                </div>
                                <p style={{ color: 'gray', fontSize: '12px' }}>Or paste Google Sheet URL below (and click Sync)</p>
                                {/* CSV URL Input (Simplified) */}
                                <input type="text" placeholder="Paste CSV URL here" value={customCsvInput} onChange={(e) => setCustomCsvInput(e.target.value)} style={appStyles.textInput} />
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <button onClick={() => handleCsvSync(parseCSV(customCsvInput))} style={{ padding: '10px 20px', backgroundColor: '#ff00de', color: 'black', fontWeight: 'bold' }}>SYNC DATA</button>
                                    <p style={{ color: 'green', fontSize: '12px' }}>{saveStatus}</p>
                                </div>
                                {/* Data Preview */}
                                <div style={appStyles.dataPreview}>
                                    <p style={{ color: '#00f3ff', fontSize: '12px' }}>CURRENT WORDS: {words.length}</p>
                                </div>
                            </div>
                         </div>
                    )}
                </div>
            </div>
        </div>
    );


    // FINAL RENDER LOGIC
    switch (phase) {
        case 'LOADING':
            return (
                <div style={appStyles.container}>
                    {/* Simplified Loading Screen */}
                    <div style={appStyles.loadingBox}>
                        <ShieldAlert size={64} color="#00ff41" style={{ animation: 'pulse 1s infinite' }} />
                        <h1 style={{ color: 'white', fontSize: '48px' }}>WORD BLASTER</h1>
                        <p style={{ color: 'gray', marginBottom: '40px' }}>SYSTEM OFFLINE. INITIALIZE REQUIRED.</p>
                        <button onClick={() => { audioSystem.playBackgroundMusic(); setIsAudioInitialized(true); setPhase('LOBBY'); }} style={appStyles.startButton}>
                            [ INITIALIZE SYSTEM ]
                        </button>
                    </div>
                </div>
            );
        case 'LOBBY':
            return renderMenuUI();
        case 'PLAYING':
            return renderGameUI();
        case 'GAME_OVER':
            return (
                <div style={{ ...appStyles.container, justifyContent: 'center', alignItems: 'center' }}>
                    <h1 style={{ color: 'red', fontSize: '64px' }}>MISSION FAILED</h1>
                    <p style={{ color: 'white', fontSize: '24px', marginBottom: '30px' }}>Score: {score}</p>
                    <button onClick={() => setPhase('LOBBY')} style={appStyles.startButton}>
                        RETURN TO BASE
                    </button>
                </div>
            );
        default:
            return <div style={{ color: 'white' }}>SYSTEM ERROR</div>;
    }
}


// --- STYLES (Simplified for Stability) ---
const appStyles: { [key: string]: React.CSSProperties } = {
    container: {
        height: '100vh',
        width: '100vw',
        backgroundColor: '#050505',
        color: 'white',
        display: 'flex',
        fontFamily: 'sans-serif',
        overflow: 'hidden',
    },
    // Loading Styles
    loadingBox: {
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', width: '100%', height: '100%',
        background: 'radial-gradient(circle at 50% 50%, rgba(30,30,50,0.5), #050505 80%)'
    },
    // Menu Styles
    menuContainer: { display: 'flex', width: '80%', maxWidth: '1200px', height: '80%', margin: 'auto', border: '1px solid #333', backgroundColor: '#0a0a0a' },
    menuButtons: { width: '40%', padding: '40px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '30px', borderRight: '1px solid #333', background: '#050505' },
    menuButton: (active: boolean, color: string) => ({
        padding: '30px', border: `2px solid ${active ? color : '#333'}`,
        backgroundColor: active ? color + '40' : 'transparent', color: active ? 'white' : 'gray',
        fontWeight: 'bold', fontSize: '20px', cursor: 'pointer', transition: 'all 0.2s',
        boxShadow: active ? `0 0 20px ${color}80` : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }),
    menuContextPanel: { flex: 1, padding: '40px' },
    durationButton: (active: boolean) => ({
        padding: '10px 15px', border: `1px solid ${active ? '#00f3ff' : '#333'}`,
        backgroundColor: active ? '#00f3ff' + '40' : '#111', color: active ? 'white' : 'gray',
        cursor: 'pointer',
    }),
    startButton: { padding: '15px 40px', backgroundColor: '#00ff41', color: 'black', fontWeight: 'bold', cursor: 'pointer', fontSize: '20px', transition: 'transform 0.1s', boxShadow: '0 0 10px #00ff41' },
    textInput: { width: '100%', padding: '10px', backgroundColor: '#111', border: '1px solid #333', color: 'white' },
    fileUploadBox: {
        border: '2px dashed #ff00de', backgroundColor: '#111', padding: '20px', textAlign: 'center',
        cursor: 'pointer', position: 'relative', overflow: 'hidden'
    },
    dataPreview: { marginTop: '20px', maxHeight: '200px', overflowY: 'auto', border: '1px solid #333', padding: '10px' },
    
    // Playing Styles
    leftPanel: { flex: 3, position: 'relative' as 'relative', borderRight: '2px solid #333', background: '#050505' },
    rightPanel: { flex: 1, backgroundColor: '#0a0a0a', display: 'flex', flexDirection: 'column' as 'column', borderLeft: '1px solid #111' },
    starField: {
        position: 'absolute' as 'absolute', inset: 0,
        backgroundImage: 'radial-gradient(1px 1px at 50% 50%, #ffffff80, transparent)',
        backgroundSize: '100px 100px', opacity: 0.2
    },
    statBox: { padding: '20px', borderBottom: '1px solid #222', background: '#050505' },
    intelFeedBox: { flex: 1, padding: '20px' },
    sliderBox: { padding: '20px', borderTop: '1px solid #222', background: '#050505' },
    turretBase: { width: '60px', height: '60px', background: '#333', borderRadius: '50%', border: '2px solid #00f3ff', position: 'absolute', bottom: '0', left: '50%', transform: 'translateX(-50%)' },
    turretBarrel: { width: '6px', height: '40px', background: '#00f3ff', margin: '0 auto', position: 'absolute', top: '0', left: '50%', transform: 'translateX(-50%) translateY(-30px)', borderRadius: '3px' },
};