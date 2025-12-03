import React, { useState, useEffect, useMemo, createContext, useContext, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import { Upload, Trash2, Users, Trophy, Swords, LayoutDashboard, Activity, Search, ChevronDown, ChevronUp, ArrowLeft, Gamepad2, BarChart2, X, Crosshair, Bomb, Target, Shield, Shuffle, Ban, Users2, ExternalLink, Flame, Footprints, Skull, Zap, LogOut, Save, RefreshCw, CheckSquare, Square, Calendar, ArrowRightLeft, Map as MapIcon, List, Clock, CheckCircle, AlertTriangle, Info, Sparkles, Send, UserCog, Edit2, Scale, FileJson, ArrowRight, Filter, FilePenLine, Menu, LayoutGrid, PieChart, ArrowUp, ArrowDown } from 'lucide-react';
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc, writeBatch } from "firebase/firestore";

// --- Firebase Config ---
const firebaseConfig = {
  apiKey: "AIzaSyClZCL60c4WBCDeoRzez8hW5V1uzQUYLJ8",
  authDomain: "jjksk-e5ca7.firebaseapp.com",
  projectId: "jjksk-e5ca7",
  storageBucket: "jjksk-e5ca7.firebasestorage.app",
  messagingSenderId: "532127539780",
  appId: "1:532127539780:web:78e4660e79a9e8e70c9211"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- Types & Interfaces ---
interface DuelData { opponent_name?: string; kills: number; deaths: number; diff?: number; }
interface PlayerStats { 
    name: string; 
    steam_id: number | string; 
    last_team_name: string; 
    last_side: string; 
    duels: { [key: string]: DuelData }; 
    kills: number; 
    deaths: number; 
    assists: number; 
    rounds_played: number; 
    damage_total: number; 
    adr?: number; // Explicit ADR from file
    opening_kills: number; 
    opening_deaths: number; 
    opening_attempts: number; 
    sniper_kills: number; 
    utility_damage: number; 
    flashes_thrown: number; 
    enemies_flashed: number;
    hltv_3_0_score: number; 
    impact?: number; 
    headshot_kills?: number; 
    trade_kills?: number; 
    clutches_won?: number; 
    clutches_won_1v1?: number; 
    clutches_won_1v2?: number; 
    clutches_won_1v3?: number; 
    clutches_won_1v4?: number; 
    clutches_won_1v5?: number; 
    weapon_kills?: { [key: string]: number };
}
interface Match { id: string; filename: string; timestamp: number; data: PlayerStats[]; }
interface AggregatedPlayerStats { 
    steam_id: string; 
    name: string; 
    matches: number; 
    kills: number; 
    deaths: number; 
    assists: number; 
    rounds_played: number; 
    damage_total: number; 
    hltv_3_0_score: number; 
    impact: number; 
    sniper_kills: number; 
    utility_damage: number; 
    flashes_thrown: number;
    enemies_flashed: number; 
    opening_kills: number; 
    opening_deaths: number; 
    opening_attempts: number; 
    trade_kills: number; 
    clutches_won: number; 
    headshot_kills: number; 
    weapon_stats: { [key: string]: number };
    [key: string]: any; 
}
type SortConfig = { key: string; direction: 'asc' | 'desc'; } | null;

// --- Contexts ---
const NotificationContext = createContext<{ notify: (t: 'success'|'error'|'info', m: string) => void }>({ notify: () => {} });
const StatsContext = createContext<{ 
    matches: Match[]; 
    addMatch: (m: Match) => Promise<void>; 
    addMatches: (m: Match[]) => Promise<void>; 
    deleteMatch: (id: string) => Promise<void>; 
    deleteMatches: (ids: string[]) => Promise<void>; 
    restoreData: (m: Match[]) => void; 
    clearAllData: () => void; 
    updatePlayerName: (id: string, name: string) => void;
    loading: boolean; 
    allPlayers: AggregatedPlayerStats[]; 
}>({ matches: [], addMatch: async () => {}, addMatches: async () => {}, deleteMatch: async () => {}, deleteMatches: async () => {}, restoreData: () => {}, clearAllData: () => {}, updatePlayerName: () => {}, loading: true, allPlayers: [] });
const AuthContext = createContext<{ isAdmin: boolean; login: (p: string) => boolean; logout: () => void }>({ isAdmin: false, login: () => false, logout: () => {} });

const useNotification = () => useContext(NotificationContext);
const useStats = () => useContext(StatsContext);
const useAuth = () => useContext(AuthContext);

// --- Helpers ---
const calculateRating = (p: AggregatedPlayerStats | PlayerStats) => {
    // Attempt to use HLTV 2.0/3.0 score if available and valid
    if (p.hltv_3_0_score && !isNaN(p.hltv_3_0_score) && p.hltv_3_0_score > 0) return p.hltv_3_0_score;
    if ((p as any).rating && !isNaN((p as any).rating) && (p as any).rating > 0) return (p as any).rating;

    // Fallback calculation (HLTV 1.0 approximation)
    // Rating = (KillRating + 0.7*SurvivalRating + RoundCountRating) / 2.7 (Simplified)
    // We will use a simplified formula closer to Impact + K/D components
    const kpr = p.rounds_played > 0 ? p.kills / p.rounds_played : 0;
    const dpr = p.rounds_played > 0 ? p.deaths / p.rounds_played : 0;
    const impact = (p as any).impact || 1.0; 
    const adr = p.rounds_played > 0 ? p.damage_total / p.rounds_played : 0;
    
    // Simple custom rating if HLTV not present:
    // Base 1.0 + (KPR - 0.67) + (0.73 - DPR) + (Impact - 1.0)/2 + (ADR-73)/100
    // This is a rough heuristic
    let rating = 1.0 + (kpr - 0.67) + (0.73 - dpr) + (impact - 1.0) * 0.5 + (adr - 75) * 0.005;
    return Math.max(0, rating);
};

const aggregatePlayerStats = (matches: Match[]): AggregatedPlayerStats[] => {
    const playerMap = new Map<string, AggregatedPlayerStats>();
    
    matches.forEach(match => {
        if (!match.data) return;
        match.data.forEach(player => {
            const id = String(player.steam_id);
            const existing = playerMap.get(id);
            const playerRating = calculateRating(player);
            
            // Collect weapon kills
            const currentWeaponStats = player.weapon_kills || {};

            if (existing) {
                // Merge weapon stats
                const mergedWeapons = { ...existing.weapon_stats };
                Object.entries(currentWeaponStats).forEach(([weapon, count]) => {
                    mergedWeapons[weapon] = (mergedWeapons[weapon] || 0) + count;
                });

                playerMap.set(id, {
                    ...existing,
                    matches: existing.matches + 1,
                    kills: existing.kills + player.kills,
                    deaths: existing.deaths + player.deaths,
                    assists: existing.assists + player.assists,
                    rounds_played: existing.rounds_played + player.rounds_played,
                    damage_total: existing.damage_total + player.damage_total,
                    hltv_3_0_score: existing.hltv_3_0_score + playerRating, // Summing ratings to average later
                    impact: existing.impact + (player.impact || 0),
                    sniper_kills: existing.sniper_kills + player.sniper_kills,
                    utility_damage: existing.utility_damage + player.utility_damage,
                    flashes_thrown: existing.flashes_thrown + player.flashes_thrown,
                    enemies_flashed: existing.enemies_flashed + (player.enemies_flashed || 0),
                    opening_kills: existing.opening_kills + player.opening_kills,
                    opening_deaths: existing.opening_deaths + player.opening_deaths,
                    opening_attempts: existing.opening_attempts + player.opening_attempts,
                    trade_kills: existing.trade_kills + (player.trade_kills || 0),
                    clutches_won: existing.clutches_won + (player.clutches_won || 0),
                    headshot_kills: existing.headshot_kills + (player.headshot_kills || 0),
                    weapon_stats: mergedWeapons,
                    // Keep most recent name
                    name: match.timestamp > (existing.last_match_timestamp || 0) ? player.name : existing.name,
                    last_match_timestamp: Math.max(existing.last_match_timestamp || 0, match.timestamp)
                });
            } else {
                playerMap.set(id, {
                    steam_id: id,
                    name: player.name,
                    matches: 1,
                    kills: player.kills,
                    deaths: player.deaths,
                    assists: player.assists,
                    rounds_played: player.rounds_played,
                    damage_total: player.damage_total,
                    hltv_3_0_score: playerRating,
                    impact: player.impact || 0,
                    sniper_kills: player.sniper_kills,
                    utility_damage: player.utility_damage,
                    flashes_thrown: player.flashes_thrown,
                    enemies_flashed: player.enemies_flashed || 0,
                    opening_kills: player.opening_kills,
                    opening_deaths: player.opening_deaths,
                    opening_attempts: player.opening_attempts,
                    trade_kills: player.trade_kills || 0,
                    clutches_won: player.clutches_won || 0,
                    headshot_kills: player.headshot_kills || 0,
                    weapon_stats: currentWeaponStats,
                    last_match_timestamp: match.timestamp
                });
            }
        });
    });

    return Array.from(playerMap.values()).map(p => ({
        ...p,
        // Average out the rating and impact
        hltv_3_0_score: p.matches > 0 ? p.hltv_3_0_score / p.matches : 0,
        impact: p.matches > 0 ? p.impact / p.matches : 0,
    }));
};

const extractDateFromFilename = (filename: string): number | null => {
    // Regex to find 10 digit sequences which often represent YYMMDDHHmm
    // Matches sequences surrounded by _, -, ., or start/end of string
    const dateRegex = /[_\-](\d{10})([_\-\.]|$)/g;
    const matches = [...filename.matchAll(dateRegex)];
    
    let lastValidTimestamp: number | null = null;

    // Iterate all matches and find the last valid date
    // This helps correctly identify date if filename has multiple numbers (like Match ID then Date)
    for (const match of matches) {
        const dateStr = match[1];
        // Expected format: YYMMDDHHmm
        const year = '20' + dateStr.substring(0, 2);
        const month = dateStr.substring(2, 4);
        const day = dateStr.substring(4, 6);
        const hour = dateStr.substring(6, 8);
        const minute = dateStr.substring(8, 10);
        
        const m = parseInt(month, 10);
        const d = parseInt(day, 10);
        const h = parseInt(hour, 10);
        const min = parseInt(minute, 10);
        
        // Basic range checks to ensure it's a date and not just a random ID
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && h >= 0 && h <= 23 && min >= 0 && min <= 59) {
             const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
             if (!isNaN(date.getTime())) {
                 lastValidTimestamp = date.getTime();
             }
        }
    }
    return lastValidTimestamp;
};

const normalizeImportedData = (data: any, filename: string): Match | null => {
    try {
        let players: PlayerStats[] = [];
        let timestamp = Date.now();
        
        // Try to extract timestamp from filename first
        const filenameTimestamp = extractDateFromFilename(filename);
        if (filenameTimestamp) {
            timestamp = filenameTimestamp;
        }

        // Check if data is in the new format { team_ct: [], team_t: [], other: [] }
        if (data.team_ct && Array.isArray(data.team_ct) && data.team_t && Array.isArray(data.team_t)) {
             // Process CT Team
             const ctPlayers = data.team_ct.map((p: any) => ({
                ...p,
                last_team_name: p.team || 'CT',
                last_side: 'CT',
                hltv_3_0_score: p.rating || 0, // Map explicit rating if available
             }));

             // Process T Team
             const tPlayers = data.team_t.map((p: any) => ({
                 ...p,
                 last_team_name: p.team || 'T',
                 last_side: 'T',
                 hltv_3_0_score: p.rating || 0,
             }));

             players = [...ctPlayers, ...tPlayers];
        } 
        // Handle standard array format
        else if (Array.isArray(data)) {
            players = data;
        } 
        // Handle wrapped data object
        else if (data.data && Array.isArray(data.data)) {
            players = data.data;
            if (data.timestamp) timestamp = new Date(data.timestamp).getTime();
        } else {
            console.error("Unknown data format", data);
            return null;
        }

        // Final normalization of fields
        players = players.map((p: any) => {
            const rounds = Number(p.rounds_played) || Number(p.rounds) || 1;
            const kills = Number(p.kills) || 0;
            
            // Handle ADR logic
            let damage = Number(p.damage_total) || Number(p.total_damage) || 0;
            const rawAdr = parseFloat(p.adr || p.ADR);
            
            // If damage is missing but ADR exists, calculate total damage. 
            // Also store adr explicitly if available to avoid rounding drift.
            if (!damage && !isNaN(rawAdr)) {
                damage = Math.round(rawAdr * rounds);
            }

            // Handle HS% logic - derive headshots from fatal_hitgroups if explicit count is missing
            let headshots = Number(p.headshot_kills) || 0;
            
            if (!headshots && p.fatal_hitgroups) {
                // Handle structure like "fatal_hitgroups": { "Head": 4, "Body": 8 }
                headshots = Number(p.fatal_hitgroups.Head) || Number(p.fatal_hitgroups.head) || 0;
            }

            // If still no headshots, check for percent shortcut
            const hsVal = p.hs_percent ?? p.hsp ?? p['hs%'] ?? p.HS_Percent ?? p.hs;
            if ((!headshots || headshots === 0) && hsVal !== undefined && kills > 0) {
                 const hsp = parseFloat(String(hsVal).replace('%', ''));
                 if (!isNaN(hsp)) {
                     // Assume percentage (0-100)
                     headshots = Math.round(kills * (hsp / 100));
                 }
            }

            return {
                name: p.name || 'Unknown',
                steam_id: p.steam_id || Math.random().toString(36).substr(2, 9),
                last_team_name: p.last_team_name || 'Unknown',
                last_side: p.last_side || 'Unknown',
                duels: p.duels || {},
                kills: kills,
                deaths: Number(p.deaths) || 0,
                assists: Number(p.assists) || 0,
                rounds_played: rounds,
                damage_total: damage,
                adr: !isNaN(rawAdr) ? rawAdr : undefined, // Persist raw ADR if available
                opening_kills: Number(p.opening_kills) || Number(p.open_kills) || 0,
                opening_deaths: Number(p.opening_deaths) || Number(p.open_deaths) || 0,
                opening_attempts: Number(p.opening_attempts) || 0,
                sniper_kills: Number(p.sniper_kills) || Number(p.awp_kills) || 0,
                utility_damage: Number(p.utility_damage) || 0,
                flashes_thrown: Number(p.flashes_thrown) || Number(p.flashes) || 0,
                enemies_flashed: Number(p.enemies_flashed) || Number(p.flash_assists) || Number(p.blinded_enemies) || Number(p.ef) || 0,
                hltv_3_0_score: Number(p.hltv_3_0_score) || Number((p as any).rating) || 0,
                impact: Number(p.impact) || 0,
                headshot_kills: headshots,
                trade_kills: Number(p.trade_kills) || 0,
                clutches_won: Number(p.clutches_won) || 0,
                weapon_kills: p.weapon_kills || {}
            };
        });

        // Calculate rating if missing or 0
        players.forEach(p => {
             if (!p.hltv_3_0_score || p.hltv_3_0_score === 0) {
                 p.hltv_3_0_score = calculateRating(p);
             }
        });

        return {
            id: Math.random().toString(36).substr(2, 9),
            filename: filename.replace('.json', ''),
            timestamp: timestamp,
            data: players
        };
    } catch (e) {
        console.error("Error normalizing data", e);
        return null;
    }
};

// --- Providers ---
const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [msg, setMsg] = useState<{ t: 'success'|'error'|'info', m: string } | null>(null);
    useEffect(() => { if(msg) { const t = setTimeout(() => setMsg(null), 3000); return () => clearTimeout(t); } }, [msg]);
    return (
        <NotificationContext.Provider value={{ notify: (t, m) => setMsg({ t, m }) }}>
            {children}
            {msg && (
                <div className={`fixed bottom-20 md:bottom-4 right-4 p-4 rounded-lg shadow-lg text-white z-50 animate-slide-up ${msg.t === 'error' ? 'bg-app-danger' : msg.t === 'success' ? 'bg-app-success' : 'bg-app-accent'}`}>
                    {msg.m}
                </div>
            )}
        </NotificationContext.Provider>
    );
};

const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isAdmin, setIsAdmin] = useState(false);
    useEffect(() => { setIsAdmin(localStorage.getItem('isAdmin') === 'true'); }, []);
    const login = (p: string) => { 
        if(p === 'admin123') { setIsAdmin(true); localStorage.setItem('isAdmin', 'true'); return true; } 
        return false; 
    };
    const logout = () => { setIsAdmin(false); localStorage.removeItem('isAdmin'); };
    return <AuthContext.Provider value={{ isAdmin, login, logout }}>{children}</AuthContext.Provider>;
};

const StatsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [matches, setMatches] = useState<Match[]>([]);
    const [loading, setLoading] = useState(true);
    const { notify } = useNotification();
    const { isAdmin } = useAuth();

    // Load matches from Firestore on mount
    useEffect(() => {
        const fetchMatches = async () => {
            setLoading(true);
            try {
                const querySnapshot = await getDocs(collection(db, "matches"));
                const loadedMatches: Match[] = [];
                querySnapshot.forEach((doc) => {
                    loadedMatches.push(doc.data() as Match);
                });
                setMatches(loadedMatches.sort((a,b) => b.timestamp - a.timestamp));
            } catch (error) {
                console.error("Error fetching matches:", error);
                notify('error', 'Failed to load matches from database.');
            } finally {
                setLoading(false);
            }
        };
        fetchMatches();
    }, [notify]);

    const addMatches = async (newMatches: Match[]) => {
        if (!isAdmin) { notify('error', 'Unauthorized'); return; }
        const batch = writeBatch(db);
        newMatches.forEach(m => {
            const docRef = doc(db, "matches", m.id);
            batch.set(docRef, m);
        });
        try {
            await batch.commit();
            // Update local state by removing duplicates by ID then adding new ones
            setMatches(prev => {
                const existingIds = new Set(newMatches.map(nm => nm.id));
                const filtered = prev.filter(p => !existingIds.has(p.id));
                return [...newMatches, ...filtered].sort((a,b) => b.timestamp - a.timestamp);
            });
            notify('success', `Saved ${newMatches.length} matches`);
        } catch(e) {
            console.error(e);
            notify('error', 'Failed to save to database');
        }
    };
    
    const addMatch = async (m: Match) => addMatches([m]);
    
    const deleteMatches = async (ids: string[]) => {
        if (!isAdmin) { notify('error', 'Unauthorized'); return; }
        if (ids.length === 0) return;

        try {
            // Chunk operations because Firebase batch limit is 500
            const chunkSize = 450;
            for (let i = 0; i < ids.length; i += chunkSize) {
                const chunk = ids.slice(i, i + chunkSize);
                const batch = writeBatch(db);
                chunk.forEach(id => {
                    const docRef = doc(db, "matches", id);
                    batch.delete(docRef);
                });
                await batch.commit();
            }

            setMatches(prev => prev.filter(m => !ids.includes(m.id)));
            notify('success', `Deleted ${ids.length} matches`);
        } catch(e) {
             console.error(e);
            notify('error', 'Failed to delete from database');
        }
    };

    const deleteMatch = (id: string) => deleteMatches([id]);
    
    const updatePlayerName = (steamId: string, newName: string) => {
       // Local update for immediate feedback, ideally this should also update DB or use a separate mapping collection
       // For this demo, we'll just update local state
       setMatches(prev => prev.map(m => ({
           ...m,
           data: m.data.map(p => String(p.steam_id) === steamId ? { ...p, name: newName } : p)
       })));
    };

    const restoreData = () => {}; // Not implementing full restore for this demo
    const clearAllData = () => {};

    const allPlayers = useMemo(() => aggregatePlayerStats(matches), [matches]);

    return (
        <StatsContext.Provider value={{ matches, addMatch, addMatches, deleteMatch, deleteMatches, restoreData, clearAllData, updatePlayerName, loading, allPlayers }}>
            {children}
        </StatsContext.Provider>
    );
};

// --- Components ---

// --- Custom Pie Chart Component (SVG based) ---
const SimplePieChart: React.FC<{ data: { label: string, value: number, color: string }[] }> = ({ data }) => {
    const total = data.reduce((acc, cur) => acc + cur.value, 0);
    let cumulativePercent = 0;

    const getCoordinatesForPercent = (percent: number) => {
        const x = Math.cos(2 * Math.PI * percent);
        const y = Math.sin(2 * Math.PI * percent);
        return [x, y];
    }

    if (total === 0) return <div className="text-center text-app-textMuted p-8">No data available</div>;

    return (
        <div className="flex flex-col md:flex-row items-center gap-8 justify-center p-8 animate-fade-in">
            <div className="relative w-64 h-64 flex-shrink-0">
                <svg viewBox="-1 -1 2 2" style={{ transform: 'rotate(-90deg)' }} className="overflow-visible w-full h-full">
                    {data.map((slice, i) => {
                        const startPercent = cumulativePercent;
                        const slicePercent = slice.value / total;
                        cumulativePercent += slicePercent;
                        const endPercent = cumulativePercent;

                        // If 100%, draw a circle
                        if (slicePercent === 1) {
                            return <circle key={i} cx="0" cy="0" r="1" fill={slice.color} />
                        }

                        // Calculate SVG path
                        const [startX, startY] = getCoordinatesForPercent(startPercent);
                        const [endX, endY] = getCoordinatesForPercent(endPercent);

                        const largeArcFlag = slicePercent > 0.5 ? 1 : 0;
                        const pathData = [
                            `M 0 0`,
                            `L ${startX} ${startY}`,
                            `A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY}`,
                            `Z`
                        ].join(' ');

                        return (
                             <path key={i} d={pathData} fill={slice.color} className="hover:opacity-80 transition-opacity cursor-pointer">
                                <title>{slice.label}: {slice.value} matches ({Math.round(slicePercent * 100)}%)</title>
                             </path>
                        );
                    })}
                </svg>
            </div>
            {/* Legend */}
            <div className="flex flex-col gap-2 w-full md:w-auto overflow-y-auto max-h-64 pr-2">
                {data.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 justify-between md:justify-start">
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded shadow-sm" style={{ backgroundColor: item.color }}></div>
                            <span className="text-white font-medium text-sm">{item.label}</span>
                        </div>
                        <span className="text-app-textMuted text-xs font-mono ml-4">{item.value} ({Math.round((item.value/total)*100)}%)</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

// --- Team Builder ---
const TeamBuilder: React.FC = () => {
    const { allPlayers } = useStats();
    const [teamA, setTeamA] = useState<string[]>([]);
    const [teamB, setTeamB] = useState<string[]>([]);
    const [search, setSearch] = useState('');

    const togglePlayer = (id: string, team: 'A' | 'B') => {
        if (team === 'A') {
            if (teamA.includes(id)) {
                setTeamA(prev => prev.filter(p => p !== id));
            } else {
                setTeamA(prev => [...prev, id]);
                setTeamB(prev => prev.filter(p => p !== id));
            }
        } else {
            if (teamB.includes(id)) {
                setTeamB(prev => prev.filter(p => p !== id));
            } else {
                setTeamB(prev => [...prev, id]);
                setTeamA(prev => prev.filter(p => p !== id));
            }
        }
    };

    const autoBalance = () => {
        const allIds = [...teamA, ...teamB];
        if (allIds.length === 0) return;

        const players = allIds
            .map(id => allPlayers.find(p => String(p.steam_id) === id))
            .filter((p): p is AggregatedPlayerStats => !!p);
            
        // Sort by rating desc
        players.sort((a, b) => b.hltv_3_0_score - a.hltv_3_0_score);

        const newA: string[] = [];
        const newB: string[] = [];
        let ratingA = 0;
        let ratingB = 0;

        players.forEach(p => {
             const maxLen = Math.ceil(players.length/2);
             // If both can take players
             if (newA.length < maxLen && newB.length < maxLen) {
                 // Add to weaker team
                 if (ratingA <= ratingB) {
                     newA.push(String(p.steam_id));
                     ratingA += p.hltv_3_0_score;
                 } else {
                     newB.push(String(p.steam_id));
                     ratingB += p.hltv_3_0_score;
                 }
             } else if (newA.length < maxLen) {
                 newA.push(String(p.steam_id));
                 ratingA += p.hltv_3_0_score;
             } else {
                 newB.push(String(p.steam_id));
                 ratingB += p.hltv_3_0_score;
             }
        });
        
        setTeamA(newA);
        setTeamB(newB);
    };

    const getTeamStats = (ids: string[]) => {
        const players = ids.map(id => allPlayers.find(p => String(p.steam_id) === id)).filter(Boolean) as AggregatedPlayerStats[];
        const count = players.length;
        if (count === 0) return { avgRating: '0.00', avgAdr: '0.0', avgKpr: '0.00', players: [] };

        const avgRating = (players.reduce((a, b) => a + b.hltv_3_0_score, 0) / count).toFixed(2);
        const avgAdr = (players.reduce((a, b) => a + (b.damage_total / b.rounds_played), 0) / count).toFixed(1);
        const avgKpr = (players.reduce((a, b) => a + (b.kills / b.rounds_played), 0) / count).toFixed(2);
        return { avgRating, avgAdr, avgKpr, players };
    };

    const statsA = getTeamStats(teamA);
    const statsB = getTeamStats(teamB);
    
    const availablePlayers = allPlayers
        .filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
        .sort((a,b) => b.hltv_3_0_score - a.hltv_3_0_score);

    return (
        <div className="p-4 md:p-6 h-full flex flex-col animate-fade-in pb-20 md:pb-6">
             <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 md:mb-6 gap-4">
                <h2 className="text-2xl font-bold flex items-center gap-2"><Users2/> Team Builder</h2>
                <div className="flex gap-2 w-full md:w-auto">
                     <button onClick={autoBalance} className="flex-1 md:flex-none justify-center text-xs text-app-accent hover:text-white px-3 py-2 md:py-1 border border-app-accent/50 rounded hover:bg-app-accent/20 transition-colors flex items-center gap-1"><Scale size={14}/> Auto Balance</button>
                     <button onClick={() => { setTeamA([]); setTeamB([]); }} className="flex-1 md:flex-none justify-center text-xs text-red-400 hover:text-red-300 px-3 py-2 md:py-1 border border-red-900/50 rounded hover:bg-red-900/20 transition-colors">Clear Teams</button>
                </div>
             </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full overflow-y-auto lg:overflow-hidden min-h-[500px]">
                {/* Player Pool */}
                <div className="bg-app-card rounded-xl border border-app-cardHover flex flex-col overflow-hidden shadow-lg order-2 lg:order-1 h-[400px] lg:h-auto">
                    <div className="p-4 border-b border-app-cardHover bg-zinc-900/50">
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 w-4 h-4 text-app-textMuted"/>
                            <input 
                                type="text" 
                                placeholder="Search players..." 
                                className="w-full bg-zinc-950 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-app-accent border border-zinc-800 text-white placeholder-zinc-600"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                         <div className="mt-2 text-xs text-app-textMuted text-right">{availablePlayers.length} players found</div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {availablePlayers.map(p => {
                            const isA = teamA.includes(String(p.steam_id));
                            const isB = teamB.includes(String(p.steam_id));
                            const isSelected = isA || isB;
                            return (
                                <div key={p.steam_id} className={`flex items-center justify-between p-2 rounded hover:bg-zinc-800 transition-colors border border-transparent hover:border-zinc-700 ${isSelected ? 'opacity-40 grayscale' : ''}`}>
                                    <div className="flex-1 min-w-0 pr-2">
                                        <div className="font-medium text-sm text-white truncate">{p.name}</div>
                                        <div className="text-xs text-app-textMuted flex gap-2">
                                            <span>{p.hltv_3_0_score.toFixed(2)} R</span>
                                            <span>{(p.damage_total/p.rounds_played).toFixed(0)} ADR</span>
                                        </div>
                                    </div>
                                    <div className="flex gap-1">
                                        <button disabled={isSelected} onClick={() => togglePlayer(String(p.steam_id), 'A')} className={`w-8 h-8 flex items-center justify-center text-xs font-bold rounded transition-colors ${isA ? 'bg-app-accent text-white' : 'bg-zinc-700 text-zinc-400 hover:text-white hover:bg-app-accent/80'}`}>A</button>
                                        <button disabled={isSelected} onClick={() => togglePlayer(String(p.steam_id), 'B')} className={`w-8 h-8 flex items-center justify-center text-xs font-bold rounded transition-colors ${isB ? 'bg-orange-500 text-white' : 'bg-zinc-700 text-zinc-400 hover:text-white hover:bg-orange-500/80'}`}>B</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Team A */}
                <div className="bg-app-card rounded-xl border border-app-cardHover flex flex-col shadow-lg lg:order-2 h-[300px] lg:h-auto">
                    <div className="p-4 border-b border-app-cardHover bg-app-accent/5">
                        <h3 className="font-bold text-app-accent mb-2 flex justify-between items-center">Team A <span className="text-xs bg-app-accent/20 px-2 py-0.5 rounded-full text-app-accent">{teamA.length}</span></h3>
                        <div className="grid grid-cols-3 gap-2 text-xs text-app-textMuted bg-zinc-900/50 p-2 rounded-lg">
                            <div className="text-center"><div className="text-white font-bold text-lg">{statsA.avgRating}</div>Rating</div>
                            <div className="text-center"><div className="text-white font-bold text-lg">{statsA.avgAdr}</div>ADR</div>
                            <div className="text-center"><div className="text-white font-bold text-lg">{statsA.avgKpr}</div>KPR</div>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                         {statsA.players.map(p => (
                             <div key={p.steam_id} className="flex items-center justify-between p-2 rounded bg-zinc-900/40 border border-zinc-800/50 group hover:border-red-500/30 transition-colors">
                                 <div>
                                     <div className="font-medium text-sm text-white">{p.name}</div>
                                     <div className="text-xs text-app-textMuted">{p.hltv_3_0_score.toFixed(2)} Rating</div>
                                 </div>
                                 <button onClick={() => togglePlayer(String(p.steam_id), 'A')} className="text-zinc-600 hover:text-red-400 p-1 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity"><X size={16}/></button>
                             </div>
                         ))}
                         {teamA.length === 0 && <div className="h-full flex items-center justify-center text-zinc-600 text-sm italic">Add players to Team A</div>}
                    </div>
                </div>

                {/* Team B */}
                <div className="bg-app-card rounded-xl border border-app-cardHover flex flex-col shadow-lg lg:order-3 h-[300px] lg:h-auto">
                    <div className="p-4 border-b border-app-cardHover bg-orange-500/5">
                        <h3 className="font-bold text-orange-500 mb-2 flex justify-between items-center">Team B <span className="text-xs bg-orange-500/20 px-2 py-0.5 rounded-full text-orange-500">{teamB.length}</span></h3>
                        <div className="grid grid-cols-3 gap-2 text-xs text-app-textMuted bg-zinc-900/50 p-2 rounded-lg">
                            <div className="text-center"><div className="text-white font-bold text-lg">{statsB.avgRating}</div>Rating</div>
                            <div className="text-center"><div className="text-white font-bold text-lg">{statsB.avgAdr}</div>ADR</div>
                            <div className="text-center"><div className="text-white font-bold text-lg">{statsB.avgKpr}</div>KPR</div>
                        </div>
                    </div>
                     <div className="flex-1 overflow-y-auto p-2 space-y-1">
                         {statsB.players.map(p => (
                             <div key={p.steam_id} className="flex items-center justify-between p-2 rounded bg-zinc-900/40 border border-zinc-800/50 group hover:border-red-500/30 transition-colors">
                                 <div>
                                     <div className="font-medium text-sm text-white">{p.name}</div>
                                     <div className="text-xs text-app-textMuted">{p.hltv_3_0_score.toFixed(2)} Rating</div>
                                 </div>
                                 <button onClick={() => togglePlayer(String(p.steam_id), 'B')} className="text-zinc-600 hover:text-red-400 p-1 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity"><X size={16}/></button>
                             </div>
                         ))}
                         {teamB.length === 0 && <div className="h-full flex items-center justify-center text-zinc-600 text-sm italic">Add players to Team B</div>}
                    </div>
                </div>
            </div>
        </div>
    );
};

const Dashboard: React.FC<{ onViewMatch: (m: Match) => void; onPlayerSelect: (id: string) => void }> = ({ onViewMatch, onPlayerSelect }) => {
    const { allPlayers, loading } = useStats();
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<SortConfig>({ key: 'hltv_3_0_score', direction: 'desc' });
    const [statsMode, setStatsMode] = useState<'avg' | 'total'>('avg');

    const sortedPlayers = useMemo(() => {
        let items = [...allPlayers];
        if (search) items = items.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
        
        if (sort) {
            items.sort((a, b) => {
                let valA = a[sort.key as keyof AggregatedPlayerStats];
                let valB = b[sort.key as keyof AggregatedPlayerStats];

                // Adjust sort value based on statsMode for specific columns
                if (statsMode === 'avg') {
                    if (sort.key === 'kills') { valA = a.kills / a.matches; valB = b.kills / b.matches; }
                    else if (sort.key === 'deaths') { valA = a.deaths / a.matches; valB = b.deaths / b.matches; }
                    else if (sort.key === 'assists') { valA = a.assists / a.matches; valB = b.assists / b.matches; }
                    else if (sort.key === 'damage_total') { valA = a.damage_total / a.rounds_played; valB = b.damage_total / b.rounds_played; }
                } else {
                    // For total mode, keep original values which are already summed
                    if (sort.key === 'damage_total') { valA = a.damage_total; valB = b.damage_total; }
                }

                // Handle derived stats sorting
                if (sort.key === 'kpr') {
                    valA = a.kills / a.rounds_played;
                    valB = b.kills / b.rounds_played;
                } else if (sort.key === 'hs_percent') {
                     valA = a.kills > 0 ? a.headshot_kills / a.kills : 0;
                     valB = b.kills > 0 ? b.headshot_kills / b.kills : 0;
                }

                if (typeof valA === 'string' && typeof valB === 'string') {
                    return sort.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
                }
                
                // Numeric sort
                valA = Number(valA) || 0;
                valB = Number(valB) || 0;
                return sort.direction === 'asc' ? valA - valB : valB - valA;
            });
        }
        return items;
    }, [allPlayers, search, sort, statsMode]);

    const handleSort = (key: string) => {
        setSort(curr => curr?.key === key && curr.direction === 'desc' ? { key, direction: 'asc' } : { key, direction: 'desc' });
    };
    
    // Calculate averages for header cards
    const avgRating = allPlayers.length ? (allPlayers.reduce((a, b) => a + b.hltv_3_0_score, 0) / allPlayers.length).toFixed(2) : '-';
    const avgAdr = allPlayers.length ? (allPlayers.reduce((a, b) => a + (b.damage_total/b.rounds_played), 0) / allPlayers.length).toFixed(1) : '-';
    const avgKd = allPlayers.length ? (allPlayers.reduce((a, b) => a + (b.kills/Math.max(1, b.deaths)), 0) / allPlayers.length).toFixed(2) : '-';

    if (loading) return <div className="flex h-full items-center justify-center"><RefreshCw className="animate-spin text-app-accent w-8 h-8"/></div>;

    return (
        <div className="space-y-6 animate-fade-in p-4 md:p-6 pb-20 md:pb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                 <div className="bg-app-card p-4 rounded-lg border border-app-cardHover flex flex-col items-center">
                    <span className="text-xs text-app-textMuted uppercase tracking-wider mb-1">Avg Rating</span>
                    <span className="text-2xl font-bold text-white">{avgRating}</span>
                 </div>
                 <div className="bg-app-card p-4 rounded-lg border border-app-cardHover flex flex-col items-center">
                    <span className="text-xs text-app-textMuted uppercase tracking-wider mb-1">Avg ADR</span>
                    <span className="text-2xl font-bold text-white">{avgAdr}</span>
                 </div>
                 <div className="bg-app-card p-4 rounded-lg border border-app-cardHover flex flex-col items-center">
                    <span className="text-xs text-app-textMuted uppercase tracking-wider mb-1">Avg K/D</span>
                    <span className="text-2xl font-bold text-white">{avgKd}</span>
                 </div>
            </div>

            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <Trophy className="text-app-accent w-6 h-6" />
                    <h2 className="text-xl font-bold">Leaderboard</h2>
                </div>
                <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
                     <div className="flex bg-app-card rounded-md border border-app-cardHover p-1 w-full md:w-auto">
                        <button 
                            onClick={() => setStatsMode('avg')}
                            className={`flex-1 md:flex-none text-xs px-3 py-1 rounded font-medium transition-colors ${statsMode === 'avg' ? 'bg-app-accent text-zinc-900' : 'text-app-textMuted hover:text-white'}`}
                        >
                            Averages
                        </button>
                        <button 
                            onClick={() => setStatsMode('total')}
                            className={`flex-1 md:flex-none text-xs px-3 py-1 rounded font-medium transition-colors ${statsMode === 'total' ? 'bg-app-accent text-zinc-900' : 'text-app-textMuted hover:text-white'}`}
                        >
                            Totals
                        </button>
                     </div>
                     <div className="relative w-full md:w-auto">
                        <Search className="absolute left-2 top-1.5 w-4 h-4 text-app-textMuted" />
                        <input 
                            type="text" 
                            placeholder="Search..." 
                            className="w-full md:w-48 bg-app-card border border-app-cardHover rounded-md pl-8 pr-4 py-1 text-sm focus:outline-none focus:border-app-accent text-white placeholder-app-textMuted"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                     </div>
                </div>
            </div>

            <div className="bg-app-card rounded-xl border border-app-cardHover overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left whitespace-nowrap">
                        <thead className="bg-zinc-900/50 text-app-textMuted uppercase text-xs font-semibold tracking-wider">
                            <tr>
                                <th className="px-4 py-3 w-10 text-center">#</th>
                                <th className="px-4 py-3 cursor-pointer hover:text-app-accent transition-colors" onClick={() => handleSort('name')}>
                                    Player {sort?.key === 'name' && (sort.direction === 'asc' ? <ChevronUp className="inline w-3 h-3"/> : <ChevronDown className="inline w-3 h-3"/>)}
                                </th>
                                <th className="px-4 py-3 text-right cursor-pointer hover:text-app-accent transition-colors" onClick={() => handleSort('matches')}>
                                    Maps {sort?.key === 'matches' && (sort.direction === 'asc' ? <ChevronUp className="inline w-3 h-3"/> : <ChevronDown className="inline w-3 h-3"/>)}
                                </th>
                                <th className="px-4 py-3 text-right cursor-pointer hover:text-app-accent transition-colors" onClick={() => handleSort('kills')}>
                                    {statsMode === 'avg' ? 'Avg K' : 'Total K'} {sort?.key === 'kills' && (sort.direction === 'asc' ? <ChevronUp className="inline w-3 h-3"/> : <ChevronDown className="inline w-3 h-3"/>)}
                                </th>
                                <th className="px-4 py-3 text-right cursor-pointer hover:text-app-accent transition-colors" onClick={() => handleSort('deaths')}>
                                    {statsMode === 'avg' ? 'Avg D' : 'Total D'} {sort?.key === 'deaths' && (sort.direction === 'asc' ? <ChevronUp className="inline w-3 h-3"/> : <ChevronDown className="inline w-3 h-3"/>)}
                                </th>
                                <th className="px-4 py-3 text-right cursor-pointer hover:text-app-accent transition-colors" onClick={() => handleSort('assists')}>
                                    {statsMode === 'avg' ? 'Avg A' : 'Total A'} {sort?.key === 'assists' && (sort.direction === 'asc' ? <ChevronUp className="inline w-3 h-3"/> : <ChevronDown className="inline w-3 h-3"/>)}
                                </th>
                                <th className="px-4 py-3 text-right cursor-pointer hover:text-app-accent transition-colors" onClick={() => handleSort('kpr')}>
                                    KPR {sort?.key === 'kpr' && (sort.direction === 'asc' ? <ChevronUp className="inline w-3 h-3"/> : <ChevronDown className="inline w-3 h-3"/>)}
                                </th>
                                <th className="px-4 py-3 text-right cursor-pointer hover:text-app-accent transition-colors" onClick={() => handleSort('hs_percent')}>
                                    HS% {sort?.key === 'hs_percent' && (sort.direction === 'asc' ? <ChevronUp className="inline w-3 h-3"/> : <ChevronDown className="inline w-3 h-3"/>)}
                                </th>
                                <th className="px-4 py-3 text-right cursor-pointer hover:text-app-accent transition-colors" onClick={() => handleSort('damage_total')}>
                                    {statsMode === 'avg' ? 'ADR' : 'Total Dmg'} {sort?.key === 'damage_total' && (sort.direction === 'asc' ? <ChevronUp className="inline w-3 h-3"/> : <ChevronDown className="inline w-3 h-3"/>)}
                                </th>
                                <th className="px-4 py-3 text-right cursor-pointer hover:text-app-accent transition-colors" onClick={() => handleSort('hltv_3_0_score')}>
                                    Rating {sort?.key === 'hltv_3_0_score' && (sort.direction === 'asc' ? <ChevronUp className="inline w-3 h-3"/> : <ChevronDown className="inline w-3 h-3"/>)}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-app-cardHover">
                            {sortedPlayers.map((p, i) => {
                                const kpr = (p.kills / p.rounds_played).toFixed(2);
                                const adr = (p.damage_total / p.rounds_played).toFixed(2);
                                const hs = p.kills > 0 ? Math.round((p.headshot_kills / p.kills) * 100) : 0;
                                
                                const displayK = statsMode === 'avg' ? (p.kills / p.matches).toFixed(1) : p.kills;
                                const displayD = statsMode === 'avg' ? (p.deaths / p.matches).toFixed(1) : p.deaths;
                                const displayA = statsMode === 'avg' ? (p.assists / p.matches).toFixed(1) : p.assists;
                                const displayDmg = statsMode === 'avg' ? adr : p.damage_total.toLocaleString();

                                // Rating color scale
                                let ratingColor = 'text-white';
                                if(p.hltv_3_0_score >= 1.20) ratingColor = 'text-app-accent';
                                else if(p.hltv_3_0_score >= 1.05) ratingColor = 'text-green-400';
                                else if(p.hltv_3_0_score < 0.90) ratingColor = 'text-red-400';

                                return (
                                    <tr key={p.steam_id} className="hover:bg-app-cardHover/50 transition-colors group cursor-pointer" onClick={() => onPlayerSelect(p.steam_id)}>
                                        <td className="px-4 py-3 text-center text-app-textMuted">{i + 1}</td>
                                        <td className="px-4 py-3 font-medium text-white group-hover:text-app-accent transition-colors">{p.name}</td>
                                        <td className="px-4 py-3 text-right text-app-textMuted">{p.matches}</td>
                                        <td className="px-4 py-3 text-right">{displayK}</td>
                                        <td className="px-4 py-3 text-right text-app-textMuted">{displayD}</td>
                                        <td className="px-4 py-3 text-right text-app-textMuted">{displayA}</td>
                                        <td className="px-4 py-3 text-right text-app-textMuted">{kpr}</td>
                                        <td className="px-4 py-3 text-right text-app-textMuted">{hs}%</td>
                                        <td className="px-4 py-3 text-right font-medium text-app-accent">{displayDmg}</td>
                                        <td className={`px-4 py-3 text-right font-bold ${ratingColor}`}>
                                            <div className="flex items-center justify-end gap-2">
                                                {p.hltv_3_0_score.toFixed(2)}
                                                <div className="w-16 h-1 bg-zinc-700 rounded-full overflow-hidden hidden md:block">
                                                    <div className={`h-full ${p.hltv_3_0_score >= 1.1 ? 'bg-app-accent' : p.hltv_3_0_score >= 1.0 ? 'bg-green-500' : 'bg-zinc-500'}`} style={{ width: `${Math.min(100, (p.hltv_3_0_score / 2) * 100)}%` }}></div>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {sortedPlayers.length === 0 && (
                                <tr>
                                    <td colSpan={10} className="px-4 py-12 text-center text-app-textMuted">
                                        No players found
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// --- Player Profile ---
const PlayerProfile: React.FC<{ steamId: string; onBack: () => void }> = ({ steamId, onBack }) => {
    const { allPlayers, matches } = useStats();
    const player = allPlayers.find(p => String(p.steam_id) === steamId);
    
    // Get recent matches for this player
    const playerMatches = matches.filter(m => m.data.some(p => String(p.steam_id) === steamId))
        .map(m => {
            const stats = m.data.find(p => String(p.steam_id) === steamId)!;
            return { ...m, stats };
        })
        .sort((a,b) => b.timestamp - a.timestamp);

    if (!player) return <div>Player not found</div>;

    const kdr = (player.kills / Math.max(1, player.deaths)).toFixed(2);
    const kpr = (player.kills / player.rounds_played).toFixed(2);
    const adr = (player.damage_total / player.rounds_played).toFixed(1);
    const hs = player.kills > 0 ? Math.round((player.headshot_kills / player.kills) * 100) : 0;
    
    // Process weapon stats for display
    const sortedWeapons = Object.entries(player.weapon_stats)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 5);

    return (
        <div className="p-4 md:p-6 space-y-6 animate-fade-in pb-20 md:pb-6">
            <button onClick={onBack} className="flex items-center text-app-textMuted hover:text-white transition-colors mb-4">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
            </button>
            
            <div className="flex flex-col md:flex-row gap-6 items-start">
                <div className="flex-1 w-full">
                    <div className="bg-app-card p-6 rounded-xl border border-app-cardHover flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                        <div>
                             <h1 className="text-3xl font-bold text-white mb-1">{player.name}</h1>
                             <div className="text-sm text-app-textMuted flex gap-4">
                                <span>{player.matches} Matches</span>
                                <span>{player.rounds_played} Rounds</span>
                             </div>
                        </div>
                        <div className="text-left md:text-right w-full md:w-auto">
                             <div className="text-4xl font-bold text-app-accent">{player.hltv_3_0_score.toFixed(2)}</div>
                             <div className="text-sm text-app-textMuted uppercase tracking-wider">Rating</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-app-card p-4 rounded-lg border border-app-cardHover">
                            <div className="text-app-textMuted text-xs uppercase">K/D Ratio</div>
                            <div className="text-xl font-bold text-white">{kdr}</div>
                        </div>
                         <div className="bg-app-card p-4 rounded-lg border border-app-cardHover">
                            <div className="text-app-textMuted text-xs uppercase">ADR</div>
                            <div className="text-xl font-bold text-white">{adr}</div>
                        </div>
                         <div className="bg-app-card p-4 rounded-lg border border-app-cardHover">
                            <div className="text-app-textMuted text-xs uppercase">KPR</div>
                            <div className="text-xl font-bold text-white">{kpr}</div>
                        </div>
                         <div className="bg-app-card p-4 rounded-lg border border-app-cardHover">
                            <div className="text-app-textMuted text-xs uppercase">HS %</div>
                            <div className="text-xl font-bold text-white">{hs}%</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-app-card rounded-xl border border-app-cardHover p-4">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Swords size={18}/> Recent Matches</h3>
                             <div className="space-y-3">
                                {playerMatches.slice(0, 5).map(m => (
                                    <div key={m.id} className="flex justify-between items-center p-3 bg-zinc-900/50 rounded hover:bg-zinc-900 transition-colors">
                                        <div className="min-w-0">
                                            <div className="font-medium text-white truncate pr-2">{m.filename}</div>
                                            <div className="text-xs text-app-textMuted">{new Date(m.timestamp).toLocaleDateString()}</div>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <div className={`font-bold ${m.stats.hltv_3_0_score >= 1.0 ? 'text-green-400' : 'text-red-400'}`}>{m.stats.hltv_3_0_score.toFixed(2)}</div>
                                            <div className="text-xs text-app-textMuted">{m.stats.kills}-{m.stats.deaths} ({m.stats.damage_total} dmg)</div>
                                        </div>
                                    </div>
                                ))}
                             </div>
                        </div>
                        <div className="bg-app-card rounded-xl border border-app-cardHover p-4">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Crosshair size={18}/> Top Weapons</h3>
                            <div className="space-y-3">
                                {sortedWeapons.map(([name, count]) => (
                                    <div key={name} className="flex justify-between items-center">
                                        <span className="text-app-textMuted">{name}</span>
                                        <span className="font-bold text-white">{count} kills</span>
                                    </div>
                                ))}
                                {sortedWeapons.length === 0 && <div className="text-app-textMuted text-sm">No weapon data available</div>}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Team Table ---
const TeamTable: React.FC<{ 
    teamName: string; 
    players: PlayerStats[]; 
    totalKills: number;
    onPlayerSelect?: (id: string) => void;
}> = ({ teamName, players, totalKills, onPlayerSelect }) => {
    const [sort, setSort] = useState<SortConfig>({ key: 'hltv_3_0_score', direction: 'desc' });

    const sortedPlayers = useMemo(() => {
        if (!sort) return players;
        return [...players].sort((a, b) => {
            let valA: any = a[sort.key as keyof PlayerStats];
            let valB: any = b[sort.key as keyof PlayerStats];
            
            // Special handling for calculated fields
            if (sort.key === 'adr') {
                valA = a.adr || (a.damage_total / (a.rounds_played || 1));
                valB = b.adr || (b.damage_total / (b.rounds_played || 1));
            } else if (sort.key === 'hs') {
                valA = a.kills > 0 ? (a.headshot_kills || 0) / a.kills : 0;
                valB = b.kills > 0 ? (b.headshot_kills || 0) / b.kills : 0;
            } else if (sort.key === 'plus_minus') {
                valA = a.kills - a.deaths;
                valB = b.kills - b.deaths;
            }

            return sort.direction === 'asc' ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
        });
    }, [players, sort]);

    const handleSort = (key: string) => {
        setSort(curr => curr?.key === key && curr.direction === 'desc' ? { key, direction: 'asc' } : { key, direction: 'desc' });
    };

    return (
        <div className="mb-8">
            <div className="flex justify-between items-end mb-2 px-1">
                <div className="flex items-center gap-2">
                    <Users2 className="w-5 h-5 text-app-textMuted" />
                    <h3 className="font-bold text-lg text-white">{teamName}</h3>
                </div>
                <div className="text-xs font-mono bg-zinc-900 px-2 py-1 rounded text-app-textMuted border border-zinc-800">
                    Total Kills: <span className="text-white">{totalKills}</span>
                </div>
            </div>
            
            <div className="bg-app-card rounded-lg border border-app-cardHover overflow-x-auto shadow-lg">
                <table className="w-full text-sm text-left table-fixed min-w-[600px]">
                     <thead className="bg-zinc-900/80 text-app-textMuted uppercase text-[10px] font-bold tracking-wider">
                        <tr>
                            <th className="px-3 py-2 w-[25%] cursor-pointer hover:text-white" onClick={() => handleSort('name')}>Player</th>
                            <th className="px-1 py-2 w-[7%] text-center cursor-pointer hover:text-white" onClick={() => handleSort('kills')}>K</th>
                            <th className="px-1 py-2 w-[7%] text-center cursor-pointer hover:text-white" onClick={() => handleSort('deaths')}>D</th>
                            <th className="px-1 py-2 w-[7%] text-center cursor-pointer hover:text-white" onClick={() => handleSort('assists')}>A</th>
                            <th className="px-1 py-2 w-[8%] text-center cursor-pointer hover:text-white" onClick={() => handleSort('plus_minus')}>+/-</th>
                            <th className="px-1 py-2 w-[8%] text-center cursor-pointer hover:text-white" onClick={() => handleSort('hs')}>HS%</th>
                            <th className="px-1 py-2 w-[10%] text-center cursor-pointer hover:text-white" onClick={() => handleSort('adr')}>ADR</th>
                            <th className="px-1 py-2 w-[7%] text-center cursor-pointer hover:text-white" onClick={() => handleSort('enemies_flashed')}>EF</th>
                            <th className="px-1 py-2 w-[10%] text-center cursor-pointer hover:text-white" onClick={() => handleSort('utility_damage')}>UD/R</th>
                            <th className="px-1 py-2 w-[8%] text-center cursor-pointer hover:text-white" onClick={() => handleSort('opening_kills')}>F/R</th>
                            <th className="px-3 py-2 w-[10%] text-right cursor-pointer hover:text-white" onClick={() => handleSort('hltv_3_0_score')}>Rating <ChevronDown className="inline w-2 h-2"/></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                        {sortedPlayers.map((p, i) => {
                            const kddiff = p.kills - p.deaths;
                            const diffColor = kddiff > 0 ? 'text-green-500' : kddiff < 0 ? 'text-red-500' : 'text-gray-500';
                            const hsPerc = p.kills > 0 ? Math.round(((p.headshot_kills || 0) / p.kills) * 100) : 0;
                            // Use explicit ADR if available, otherwise calculate
                            const adr = p.adr !== undefined ? p.adr.toFixed(1) : (p.damage_total / p.rounds_played).toFixed(1);
                            const udr = (p.utility_damage / p.rounds_played).toFixed(1);
                            const fr = (p.opening_kills / p.rounds_played).toFixed(2);
                            
                            let ratingColor = 'text-white';
                            const rating = p.hltv_3_0_score || 0;
                            if(rating >= 1.5) ratingColor = 'text-app-accent';
                            else if(rating >= 1.1) ratingColor = 'text-sky-300';
                            else if(rating < 0.8) ratingColor = 'text-red-400';

                            return (
                                <tr key={i} className="hover:bg-zinc-700/30 transition-colors group cursor-pointer" onClick={() => onPlayerSelect && onPlayerSelect(String(p.steam_id))}>
                                    <td className="px-3 py-2.5 font-bold text-zinc-300 group-hover:text-white truncate" title={p.name}>{p.name}</td>
                                    <td className="px-1 py-2.5 text-center text-zinc-300">{p.kills}</td>
                                    <td className="px-1 py-2.5 text-center text-zinc-400">{p.deaths}</td>
                                    <td className="px-1 py-2.5 text-center text-zinc-400">{p.assists}</td>
                                    <td className={`px-1 py-2.5 text-center font-medium ${diffColor}`}>{kddiff > 0 ? `+${kddiff}` : kddiff}</td>
                                    <td className="px-1 py-2.5 text-center text-zinc-400 text-xs">{hsPerc}%</td>
                                    <td className="px-1 py-2.5 text-center text-zinc-300 font-mono text-xs">{adr}</td>
                                    <td className="px-1 py-2.5 text-center text-zinc-400 text-xs">{p.enemies_flashed || 0}</td>
                                    <td className="px-1 py-2.5 text-center text-zinc-400 text-xs">{udr}</td>
                                    <td className="px-1 py-2.5 text-center text-zinc-400 text-xs">{fr}</td>
                                    <td className={`px-3 py-2.5 text-right font-bold ${ratingColor}`}>{rating.toFixed(2)}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// --- Match Viewer ---
const MatchViewer: React.FC<{ match: Match; onBack: () => void; onPlayerSelect: (id: string) => void }> = ({ match, onBack, onPlayerSelect }) => {
    
    // Strict Team Splitting Logic
    const { teamAPlayers, teamBPlayers } = useMemo(() => {
        const players = match.data;
        
        // 1. Check for explicit "CT" and "T" sides/names
        // Be strict: 'CT' exactly or 'T' exactly to avoid substring overlap
        const ctPlayers = players.filter(p => 
            (p.last_side && p.last_side === 'CT') || 
            (p.last_team_name && (p.last_team_name === 'CT' || p.last_team_name === 'Team CT'))
        );
        const tPlayers = players.filter(p => 
            (p.last_side && p.last_side === 'T') || 
            (p.last_team_name && (p.last_team_name === 'T' || p.last_team_name === 'Team T'))
        );

        if (ctPlayers.length > 0 && tPlayers.length > 0) {
             // If we found strict matches, use them.
             // Usually team_ct is Team A (first table) and team_t is Team B (second table)
             return { teamAPlayers: ctPlayers, teamBPlayers: tPlayers };
        }

        // 2. Fallback: Split by unique team names if > 1 unique team found
        const uniqueTeams = Array.from(new Set(players.map(p => p.last_team_name).filter(Boolean)));
        if (uniqueTeams.length === 2) {
             return {
                 teamAPlayers: players.filter(p => p.last_team_name === uniqueTeams[0]),
                 teamBPlayers: players.filter(p => p.last_team_name === uniqueTeams[1])
             }
        }

        // 3. Fallback: Simple Split (First 5 vs Rest)
        // This is the user's requested fallback rule
        const midpoint = Math.ceil(players.length / 2);
        return {
            teamAPlayers: players.slice(0, midpoint),
            teamBPlayers: players.slice(midpoint)
        };

    }, [match]);

    const teamAKills = teamAPlayers.reduce((a, b) => a + b.kills, 0);
    const teamBKills = teamBPlayers.reduce((a, b) => a + b.kills, 0);

    return (
        <div className="p-4 md:p-6 animate-fade-in pb-20">
            <div className="flex items-center gap-4 mb-6">
                <button onClick={onBack} className="p-2 bg-app-card hover:bg-app-cardHover rounded-lg transition-colors">
                    <ArrowLeft size={20} />
                </button>
                <div className="min-w-0">
                    <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2 truncate">
                        {match.filename}
                    </h1>
                    <div className="text-app-textMuted text-sm">
                        {new Date(match.timestamp).toLocaleString()}
                    </div>
                </div>
            </div>

            <TeamTable 
                teamName="Team A" 
                players={teamAPlayers} 
                totalKills={teamAKills} 
                onPlayerSelect={onPlayerSelect}
            />

            <TeamTable 
                teamName="Team B" 
                players={teamBPlayers} 
                totalKills={teamBKills} 
                onPlayerSelect={onPlayerSelect}
            />
        </div>
    );
};

const Settings: React.FC = () => {
    const { isAdmin, login, logout } = useAuth();
    const { addMatch, matches, deleteMatches } = useStats();
    const [password, setPassword] = useState('');
    const [uploading, setUploading] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const { notify } = useNotification();
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    // Editor State
    const [editingMatch, setEditingMatch] = useState<Match | null>(null);
    const [editContent, setEditContent] = useState('');

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        if (login(password)) { notify('success', 'Logged in'); setPassword(''); } 
        else notify('error', 'Incorrect password');
    };

    const processFile = async (file: File) => {
        try {
            const text = await file.text();
            const json = JSON.parse(text);
            const match = normalizeImportedData(json, file.name);
            if (match) await addMatch(match);
            else notify('error', `Invalid format: ${file.name}`);
        } catch (e) {
            console.error(e);
            notify('error', `Error parsing ${file.name}`);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return;
        setUploading(true);
        const files = Array.from(e.target.files) as File[];
        
        for (const file of files) {
            if (file.name.endsWith('.zip')) {
                try {
                    const zip = await JSZip.loadAsync(file);
                    const jsonFiles = Object.values(zip.files).filter((f: any) => f.name.endsWith('.json'));
                    for (const f of jsonFiles as any[]) {
                         const text = await f.async('text');
                         const json = JSON.parse(text);
                         const match = normalizeImportedData(json, f.name);
                         if (match) await addMatch(match);
                    }
                } catch(err) {
                    notify('error', 'Error reading zip');
                }
            } else if (file.name.endsWith('.json')) {
                await processFile(file);
            }
        }
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const startEdit = (m: Match) => {
        setEditingMatch(m);
        setEditContent(JSON.stringify(m, null, 2));
    };

    const saveEdit = async () => {
        if (!editingMatch) return;
        try {
            let parsed = JSON.parse(editContent);
            
            // Heuristic: If user pasted a raw log structure, try to normalize it while keeping original ID
            if (!parsed.data && (parsed.team_ct || parsed.team_t)) {
                const normalized = normalizeImportedData(parsed, editingMatch.filename);
                if (normalized) {
                    // Preserve original ID
                    normalized.id = editingMatch.id;
                    parsed = normalized;
                } else {
                    throw new Error("Failed to normalize raw data");
                }
            } else if (!parsed.id) {
                 // Ensure ID exists if manual JSON editing removed it
                 parsed.id = editingMatch.id;
            }

            await addMatch(parsed);
            notify('success', 'Match updated successfully');
            setEditingMatch(null);
        } catch (e) {
            console.error(e);
            notify('error', 'Invalid JSON content');
        }
    };

    if (!isAdmin) {
        return (
            <div className="flex items-center justify-center h-full p-6">
                <form onSubmit={handleLogin} className="bg-app-card p-8 rounded-xl border border-app-cardHover w-full max-w-md shadow-2xl">
                    <div className="flex justify-center mb-6">
                        <Shield className="w-12 h-12 text-app-accent" />
                    </div>
                    <h2 className="text-2xl font-bold text-center mb-6">Admin Access</h2>
                    <input 
                        type="password" 
                        value={password} 
                        onChange={e => setPassword(e.target.value)} 
                        placeholder="Enter password" 
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 mb-4 focus:border-app-accent focus:outline-none transition-colors"
                    />
                    <button type="submit" className="w-full bg-app-accent hover:bg-app-accentHover text-zinc-900 font-bold py-3 rounded-lg transition-colors">
                        Login
                    </button>
                </form>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 space-y-8 animate-fade-in relative pb-20 md:pb-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold flex items-center gap-2"><UserCog /> Settings</h1>
                <button onClick={logout} className="px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg flex items-center gap-2 transition-colors">
                    <LogOut size={16} /> Logout
                </button>
            </div>

            <div className="bg-app-card rounded-xl border border-app-cardHover p-6">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Upload /> Import Matches</h3>
                <div className="border-2 border-dashed border-zinc-700 rounded-xl p-8 text-center hover:border-app-accent hover:bg-zinc-800/30 transition-all cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                    <input type="file" ref={fileInputRef} onChange={handleFileUpload} multiple accept=".json,.zip" className="hidden" />
                    <Upload className="w-10 h-10 text-app-textMuted mx-auto mb-4" />
                    <p className="font-medium text-white mb-1">Click to upload JSON or ZIP files</p>
                    <p className="text-sm text-app-textMuted">Supports multiple files</p>
                    {uploading && <p className="mt-4 text-app-accent animate-pulse">Uploading...</p>}
                </div>
            </div>

            <div className="bg-app-card rounded-xl border border-app-cardHover p-6">
                <div className="flex justify-between items-center mb-4">
                     <h3 className="text-lg font-bold flex items-center gap-2"><List /> Managed Matches ({matches.length})</h3>
                     <button 
                         onClick={async () => { 
                             if(confirm(`Are you sure you want to delete all ${matches.length} matches? This cannot be undone.`)) {
                                 setIsDeleting(true);
                                 await deleteMatches(matches.map(m=>m.id));
                                 setIsDeleting(false);
                             }
                         }} 
                         disabled={isDeleting || matches.length === 0}
                         className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                     >
                         {isDeleting ? 'Deleting...' : 'Delete All'}
                     </button>
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                    {matches.map(m => (
                        <div key={m.id} className="flex justify-between items-center p-3 bg-zinc-900/50 rounded hover:bg-zinc-900 transition-colors group">
                            <span className="text-sm truncate max-w-[200px] md:max-w-[300px]" title={m.filename}>{m.filename}</span>
                            <div className="flex items-center gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => startEdit(m)} className="text-zinc-500 hover:text-app-accent p-2 bg-zinc-800 hover:bg-zinc-700 rounded" title="Edit JSON">
                                    <FilePenLine size={16} />
                                </button>
                                <button onClick={() => deleteMatches([m.id])} className="text-zinc-500 hover:text-red-500 p-2 bg-zinc-800 hover:bg-zinc-700 rounded" title="Delete">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    ))}
                    {matches.length === 0 && <div className="text-center text-app-textMuted py-4">No matches found.</div>}
                </div>
            </div>

            {/* Editor Modal */}
            {editingMatch && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-zinc-900 rounded-xl border border-zinc-700 w-full max-w-4xl h-[80vh] flex flex-col shadow-2xl">
                        <div className="p-4 border-b border-zinc-700 flex justify-between items-center">
                            <h3 className="font-bold flex items-center gap-2"><FileJson size={18}/> Edit Match Data</h3>
                            <button onClick={() => setEditingMatch(null)} className="text-zinc-400 hover:text-white"><X size={20}/></button>
                        </div>
                        <div className="flex-1 p-0 overflow-hidden relative">
                            <textarea 
                                className="w-full h-full bg-zinc-950 text-green-400 font-mono text-xs p-4 focus:outline-none resize-none"
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                spellCheck={false}
                            />
                        </div>
                        <div className="p-4 border-t border-zinc-700 flex justify-between items-center bg-zinc-900 rounded-b-xl">
                            <span className="text-xs text-zinc-500 hidden md:inline">Edit raw JSON object. Use valid syntax.</span>
                            <div className="flex gap-3 w-full md:w-auto justify-end">
                                <button onClick={() => setEditingMatch(null)} className="px-4 py-2 text-zinc-400 hover:text-white text-sm">Cancel</button>
                                <button onClick={saveEdit} className="px-4 py-2 bg-app-accent hover:bg-app-accentHover text-zinc-900 font-bold rounded-lg text-sm flex items-center gap-2">
                                    <Save size={16}/> Save Changes
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- App ---
const App: React.FC = () => {
    const [view, setView] = useState<'dashboard' | 'matches' | 'players' | 'settings' | 'teambuilder'>('dashboard');
    const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
    const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

    const handlePlayerSelect = (id: string) => {
        setSelectedPlayerId(id);
        // We stay in the current main view context (e.g. inside a match) but show profile overlay/view
        // For simplicity, let's treat 'playerProfile' as a sub-state or just switch main view if coming from Dashboard
    };

    // If a player is selected, we override the main view content with the player profile
    // unless we are inside a match, in which case we might want to navigate away or show it.
    // Given the request "links to profile in matches", clicking a player in MatchViewer should show profile.
    
    const renderContent = () => {
        if (selectedPlayerId) {
            return <PlayerProfile steamId={selectedPlayerId} onBack={() => setSelectedPlayerId(null)} />;
        }

        if (selectedMatch) {
            return <MatchViewer match={selectedMatch} onBack={() => setSelectedMatch(null)} onPlayerSelect={handlePlayerSelect} />;
        }

        switch (view) {
            case 'dashboard':
                return <Dashboard onViewMatch={setSelectedMatch} onPlayerSelect={handlePlayerSelect} />;
            case 'matches':
                return (
                    <div className="p-4 md:p-6 pb-20 md:pb-6">
                        <h2 className="text-2xl font-bold mb-6">Recent Matches</h2>
                         <MatchesList onViewMatch={setSelectedMatch} />
                    </div>
                );
            case 'players':
                 // Reusing dashboard for players list essentially, or could be a distinct list
                return <Dashboard onViewMatch={setSelectedMatch} onPlayerSelect={handlePlayerSelect} />;
            case 'teambuilder':
                return <TeamBuilder />;
            case 'settings':
                return <Settings />;
            default:
                return <Dashboard onViewMatch={setSelectedMatch} onPlayerSelect={handlePlayerSelect} />;
        }
    };

    return (
        <AuthProvider>
            <NotificationProvider>
                <StatsProvider>
                    <div className="flex h-screen bg-app-bg text-app-text overflow-hidden font-sans selection:bg-app-accent selection:text-white flex-col md:flex-row">
                        {/* Sidebar - Desktop */}
                        <div className="hidden md:flex w-64 bg-zinc-900 border-r border-zinc-800 flex-col flex-shrink-0">
                            <div className="p-6 flex items-center gap-3">
                                <div className="w-8 h-8 bg-gradient-to-br from-app-accent to-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-app-accent/20">
                                    <Activity className="text-white" size={20} />
                                </div>
                                <div>
                                    <h1 className="font-bold text-xl tracking-tight text-white">Stats<span className="text-app-accent">Tracker</span></h1>
                                </div>
                            </div>

                            <nav className="flex-1 px-4 py-4 space-y-1">
                                <NavButton icon={<LayoutDashboard size={20} />} label="Dashboard" active={view === 'dashboard' && !selectedMatch && !selectedPlayerId} onClick={() => { setView('dashboard'); setSelectedMatch(null); setSelectedPlayerId(null); }} />
                                <NavButton icon={<Gamepad2 size={20} />} label="Matches" active={view === 'matches' || !!selectedMatch} onClick={() => { setView('matches'); setSelectedMatch(null); setSelectedPlayerId(null); }} />
                                <NavButton icon={<Users size={20} />} label="Players" active={view === 'players' || !!selectedPlayerId} onClick={() => { setView('players'); setSelectedMatch(null); setSelectedPlayerId(null); }} />
                                <NavButton icon={<Users2 size={20} />} label="Team Builder" active={view === 'teambuilder'} onClick={() => { setView('teambuilder'); setSelectedMatch(null); setSelectedPlayerId(null); }} />
                                <NavButton icon={<UserCog size={20} />} label="Settings" active={view === 'settings'} onClick={() => { setView('settings'); setSelectedMatch(null); setSelectedPlayerId(null); }} />
                            </nav>

                            <div className="p-4 border-t border-zinc-800">
                                <button className="flex items-center gap-2 text-sm text-zinc-500 hover:text-white transition-colors w-full px-2 py-2 rounded-lg hover:bg-zinc-800">
                                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                    System Online
                                </button>
                            </div>
                        </div>

                        {/* Header - Mobile */}
                        <div className="md:hidden flex items-center justify-between p-4 bg-zinc-900 border-b border-zinc-800 z-20">
                            <div className="font-bold text-xl tracking-tight text-white flex items-center gap-2">
                                <div className="w-8 h-8 bg-gradient-to-br from-app-accent to-blue-600 rounded-lg flex items-center justify-center">
                                     <Activity className="text-white" size={20} />
                                </div>
                                Stats<span className="text-app-accent">Tracker</span>
                            </div>
                             <div className="text-xs text-green-500 flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full bg-green-500"></div> Online
                            </div>
                        </div>

                        {/* Main Content */}
                        <main className="flex-1 overflow-auto bg-app-bg relative pb-0">
                            {renderContent()}
                        </main>

                        {/* Bottom Navigation - Mobile */}
                        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 flex justify-around items-center p-2 z-50 pb-safe safe-area-bottom">
                            <MobileNavButton icon={<LayoutDashboard size={24} />} label="Home" active={view === 'dashboard' && !selectedMatch && !selectedPlayerId} onClick={() => { setView('dashboard'); setSelectedMatch(null); setSelectedPlayerId(null); }} />
                            <MobileNavButton icon={<Gamepad2 size={24} />} label="Matches" active={view === 'matches' || !!selectedMatch} onClick={() => { setView('matches'); setSelectedMatch(null); setSelectedPlayerId(null); }} />
                            <MobileNavButton icon={<Users2 size={24} />} label="Teams" active={view === 'teambuilder'} onClick={() => { setView('teambuilder'); setSelectedMatch(null); setSelectedPlayerId(null); }} />
                            <MobileNavButton icon={<UserCog size={24} />} label="Settings" active={view === 'settings'} onClick={() => { setView('settings'); setSelectedMatch(null); setSelectedPlayerId(null); }} />
                        </div>
                    </div>
                </StatsProvider>
            </NotificationProvider>
        </AuthProvider>
    );
};

// --- Helper Components ---
const NavButton: React.FC<{ icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }> = ({ icon, label, active, onClick }) => (
    <button 
        onClick={onClick} 
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${active ? 'bg-app-accent text-white shadow-lg shadow-app-accent/20' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
    >
        <div className={`${active ? 'text-white' : 'text-zinc-500 group-hover:text-white'}`}>{icon}</div>
        <span className="font-medium">{label}</span>
    </button>
);

const MobileNavButton: React.FC<{ icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }> = ({ icon, label, active, onClick }) => (
    <button 
        onClick={onClick} 
        className={`flex flex-col items-center justify-center p-2 w-full transition-colors ${active ? 'text-app-accent' : 'text-zinc-500'}`}
    >
        <div className="mb-1">{icon}</div>
        <span className="text-[10px] font-medium">{label}</span>
    </button>
);

const MatchesList: React.FC<{ onViewMatch: (m: Match) => void }> = ({ onViewMatch }) => {
    const { matches, loading, deleteMatch } = useStats();
    const { isAdmin } = useAuth();
    const [search, setSearch] = useState('');
    const [viewMode, setViewMode] = useState<'grid' | 'list' | 'chart'>('grid');
    const [sort, setSort] = useState<'date' | 'map' | 'players' | 'kills'>('date');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const parseMatchInfo = (filename: string, timestamp: number) => {
        const mapRegex = /(de_|cs_)\w+/;
        const mapMatch = filename.match(mapRegex);
        let mapName = mapMatch ? mapMatch[0] : 'Unknown Map';

        let displayDate = new Date(timestamp);
        const filenameTimestamp = extractDateFromFilename(filename);
        if (filenameTimestamp) {
            displayDate = new Date(filenameTimestamp);
        }

        const d = String(displayDate.getDate()).padStart(2, '0');
        const mo = String(displayDate.getMonth() + 1).padStart(2, '0');
        const y = displayDate.getFullYear();
        const ho = String(displayDate.getHours()).padStart(2, '0');
        const mi = String(displayDate.getMinutes()).padStart(2, '0');
        
        return { mapName, date: `${d}.${mo}.${y} ${ho}:${mi}`, timestamp: displayDate.getTime() };
    };

    const processedMatches = useMemo(() => {
        const term = search.toLowerCase();
        return matches
            .map(m => {
                const info = parseMatchInfo(m.filename, m.timestamp);
                const totalKills = m.data.reduce((a, b) => a + b.kills, 0);
                return { ...m, ...info, totalKills, playerCount: m.data.length };
            })
            .filter(m => {
                 return m.mapName.toLowerCase().includes(term) || 
                        m.date.includes(term) || 
                        m.filename.toLowerCase().includes(term);
            })
            .sort((a, b) => {
                if (sort === 'date') {
                    return sortDir === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp;
                } else if (sort === 'map') {
                    return sortDir === 'asc' 
                        ? a.mapName.localeCompare(b.mapName) 
                        : b.mapName.localeCompare(a.mapName);
                } else if (sort === 'players') {
                    return sortDir === 'asc' ? a.playerCount - b.playerCount : b.playerCount - a.playerCount;
                } else if (sort === 'kills') {
                    return sortDir === 'asc' ? a.totalKills - b.totalKills : b.totalKills - a.totalKills;
                }
                return 0;
            });
    }, [matches, search, sort, sortDir]);

    // Calculate map distribution for the pie chart
    const mapDistribution = useMemo(() => {
        const dist: Record<string, number> = {};
        processedMatches.forEach(m => {
            dist[m.mapName] = (dist[m.mapName] || 0) + 1;
        });

        // Colors palette
        const colors = ['#38bdf8', '#818cf8', '#a78bfa', '#c084fc', '#f472b6', '#fb7185', '#34d399', '#facc15', '#60a5fa', '#4ade80'];
        
        return Object.entries(dist)
            .sort((a, b) => b[1] - a[1])
            .map(([label, value], index) => ({
                label,
                value,
                color: colors[index % colors.length]
            }));
    }, [processedMatches]);

    if (loading) return <div className="flex h-64 items-center justify-center"><RefreshCw className="animate-spin text-app-accent w-8 h-8"/></div>;

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-app-card/50 p-2 rounded-xl border border-app-cardHover">
                <div className="relative w-full md:max-w-md group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-app-accent transition-colors"/>
                    <input 
                        type="text" 
                        placeholder="Search matches..." 
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-app-accent/50 focus:bg-zinc-950 transition-all placeholder-zinc-600 text-white"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                
                <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
                    {/* Sort Controls */}
                    <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
                         <select 
                            value={sort}
                            onChange={(e) => setSort(e.target.value as 'date' | 'map' | 'players' | 'kills')}
                            className="bg-transparent text-sm text-zinc-300 focus:outline-none p-1.5 cursor-pointer hover:text-white"
                         >
                             <option value="date">Date</option>
                             <option value="map">Map</option>
                             <option value="players">Players</option>
                             <option value="kills">Total Kills</option>
                         </select>
                         <button 
                            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                            className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded transition-colors"
                            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
                         >
                             {sortDir === 'asc' ? <ArrowUp size={16}/> : <ArrowDown size={16}/>}
                         </button>
                    </div>

                    {/* View Switcher */}
                    <div className="flex bg-zinc-900 p-1 rounded-lg border border-zinc-800">
                        <button 
                            onClick={() => setViewMode('grid')}
                            className={`p-2 rounded-md transition-all ${viewMode === 'grid' ? 'bg-app-card shadow-lg text-app-accent' : 'text-zinc-500 hover:text-white hover:bg-zinc-800'}`}
                            title="Grid View"
                        >
                            <LayoutGrid size={18} />
                        </button>
                        <button 
                            onClick={() => setViewMode('list')}
                            className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-app-card shadow-lg text-app-accent' : 'text-zinc-500 hover:text-white hover:bg-zinc-800'}`}
                            title="List View"
                        >
                            <List size={18} />
                        </button>
                        <button 
                            onClick={() => setViewMode('chart')}
                            className={`p-2 rounded-md transition-all ${viewMode === 'chart' ? 'bg-app-card shadow-lg text-app-accent' : 'text-zinc-500 hover:text-white hover:bg-zinc-800'}`}
                            title="Map Distribution"
                        >
                            <PieChart size={18} />
                        </button>
                    </div>
                </div>
            </div>

            {processedMatches.length === 0 && (
                <div className="text-center py-12 text-app-textMuted flex flex-col items-center">
                    <Search className="w-12 h-12 mb-4 opacity-20"/>
                    <p>No matches found matching "{search}"</p>
                </div>
            )}

            {viewMode === 'chart' ? (
                <div className="bg-app-card border border-app-cardHover rounded-xl p-6 shadow-lg">
                    <h3 className="font-bold text-lg text-white mb-2 text-center">Map Distribution</h3>
                    <SimplePieChart data={mapDistribution} />
                </div>
            ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {processedMatches.map(m => (
                        <div key={m.id} className="bg-app-card border border-app-cardHover rounded-xl p-5 hover:border-app-accent transition-all cursor-pointer group relative shadow-lg overflow-hidden animate-fade-in" onClick={() => onViewMatch(m)}>
                            <div className="flex justify-between items-start mb-6">
                                    <div className="text-app-accent">
                                    <Swords size={20} />
                                    </div>
                                    <div className="text-right">
                                        <span className="text-[10px] font-mono text-zinc-500 block uppercase tracking-wide">{m.date}</span>
                                    </div>
                            </div>
                            <h3 className="font-bold text-lg text-white mb-6 truncate">{m.mapName}</h3>
                            <div className="flex items-center gap-6 text-xs text-zinc-500 font-mono mt-auto">
                                <div className="flex items-center gap-1.5"><Users size={12} /> {m.playerCount} Players</div>
                                <div className="flex items-center gap-1.5"><Crosshair size={12} /> {m.totalKills} Kills</div>
                            </div>
                            {isAdmin && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); deleteMatch(m.id); }} 
                                    className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 p-2 text-zinc-500 hover:text-red-500 hover:bg-zinc-800 rounded transition-all"
                                >
                                    <Trash2 size={16} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {processedMatches.map(m => (
                        <div key={m.id} onClick={() => onViewMatch(m)} className="group flex items-center justify-between p-4 bg-app-card border border-app-cardHover rounded-xl hover:border-app-accent cursor-pointer transition-all animate-fade-in">
                            <div className="flex items-center gap-4 min-w-0">
                                <div className="w-10 h-10 rounded-lg bg-zinc-900 flex items-center justify-center text-app-accent flex-shrink-0 border border-zinc-800">
                                    <Swords size={20} />
                                </div>
                                <div className="min-w-0">
                                    <h4 className="font-bold text-white truncate">{m.mapName}</h4>
                                    <div className="text-xs text-zinc-500 font-mono">{m.date}</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-8 text-sm text-zinc-400 font-mono flex-shrink-0 ml-4 hidden md:flex">
                                    <div className="flex items-center gap-2"><Users size={14} /> {m.playerCount} Players</div>
                                    <div className="flex items-center gap-2"><Crosshair size={14} /> {m.totalKills} Kills</div>
                            </div>
                            {isAdmin && (
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); deleteMatch(m.id); }} 
                                        className="ml-4 p-2 text-zinc-500 hover:text-red-500 hover:bg-zinc-800 rounded opacity-0 group-hover:opacity-100 transition-all"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);