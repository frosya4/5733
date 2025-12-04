import React, { useState, useEffect, useMemo, createContext, useContext, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import { Upload, Trash2, Users, Trophy, Swords, LayoutDashboard, Activity, Search, ChevronDown, ChevronUp, ArrowLeft, Gamepad2, BarChart2, X, Crosshair, Bomb, Target, Shield, Shuffle, Ban, Users2, ExternalLink, Flame, Footprints, Skull, Zap, LogOut, Save, RefreshCw, CheckSquare, Square, Calendar, ArrowRightLeft, Map as MapIcon, List, Clock, CheckCircle, AlertTriangle, Info, Sparkles, Send, UserCog, Edit2, Scale, FileJson, ArrowRight, Filter, FilePenLine, Menu, LayoutGrid, PieChart, ArrowUp, ArrowDown, Crown, Medal } from 'lucide-react';
// @ts-ignore
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
const calculateRating = (p: AggregatedPlayerStats | PlayerStats): number => {
    // Attempt to use HLTV 2.0/3.0 score if available and valid
    if (p.hltv_3_0_score && !isNaN(p.hltv_3_0_score) && p.hltv_3_0_score > 0) return p.hltv_3_0_score;
    if ((p as any).rating && !isNaN((p as any).rating) && (p as any).rating > 0) return Number((p as any).rating);

    // Fallback calculation (HLTV 1.0 approximation)
    const kpr = p.rounds_played > 0 ? p.kills / p.rounds_played : 0;
    const dpr = p.rounds_played > 0 ? p.deaths / p.rounds_played : 0;
    const impact = (p as any).impact || 1.0; 
    const adr = p.rounds_played > 0 ? p.damage_total / p.rounds_played : 0;
    
    // Simple custom rating if HLTV not present
    let rating = 1.0 + (kpr - 0.67) + (0.73 - dpr) + (impact - 1.0) * 0.5 + (adr - 75) * 0.005;
    return Math.max(0, rating);
};

const formatMapName = (filename: string): string => {
    // Remove extension
    let name = filename.replace('.json', '');
    
    // Check for de_ or cs_ prefix
    const match = name.match(/(?:de_|cs_)([a-zA-Z0-9_]+)/);
    
    if (match && match[1]) {
        name = match[1];
    } else {
        // Fallback: simple replace if the regex didn't catch complex cases but prefix exists
        name = name.replace(/^(de_|cs_)/, '');
    }

    // Replace underscores with spaces if needed, but usually map names like 'dust2' are fine. 
    // Capitalize first letter
    return name.charAt(0).toUpperCase() + name.slice(1);
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

    for (const match of matches) {
        const dateStr = match[1];
        const year = '20' + dateStr.substring(0, 2);
        const month = dateStr.substring(2, 4);
        const day = dateStr.substring(4, 6);
        const hour = dateStr.substring(6, 8);
        const minute = dateStr.substring(8, 10);
        
        const m = parseInt(month, 10);
        const d = parseInt(day, 10);
        const h = parseInt(hour, 10);
        const min = parseInt(minute, 10);
        
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
            
            if (!damage && !isNaN(rawAdr)) {
                damage = Math.round(rawAdr * rounds);
            }

            // Handle HS% logic
            let headshots = Number(p.headshot_kills) || 0;
            
            if (!headshots && p.fatal_hitgroups) {
                headshots = Number(p.fatal_hitgroups.Head) || Number(p.fatal_hitgroups.head) || 0;
            }

            const hsVal = p.hs_percent ?? p.hsp ?? p['hs%'] ?? p.HS_Percent ?? p.hs;
            if ((!headshots || headshots === 0) && hsVal !== undefined && kills > 0) {
                 const hsp = parseFloat(String(hsVal).replace('%', ''));
                 if (!isNaN(hsp)) {
                     headshots = Math.round(kills * (hsp / 100));
                 }
            }

            return {
                name: p.name || 'Unknown',
                steam_id: p.steam_id || Math.random().toString(36).substr(2, 9),
                last_team_name: p.last_team_name || p.team || 'Unknown',
                last_side: p.last_side || 'Unknown',
                duels: p.duels || {},
                kills: kills,
                deaths: Number(p.deaths) || 0,
                assists: Number(p.assists) || 0,
                rounds_played: rounds,
                damage_total: damage,
                adr: !isNaN(rawAdr) ? rawAdr : undefined,
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
       setMatches(prev => prev.map(m => ({
           ...m,
           data: m.data.map(p => String(p.steam_id) === steamId ? { ...p, name: newName } : p)
       })));
    };

    const restoreData = () => {}; 
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
    const total = data.reduce((acc: number, cur) => acc + cur.value, 0);
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

                        if (slicePercent === 1) {
                            return <circle key={i} cx="0" cy="0" r="1" fill={slice.color} />
                        }

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
            
        players.sort((a, b) => b.hltv_3_0_score - a.hltv_3_0_score);

        const newA: string[] = [];
        const newB: string[] = [];
        let ratingA: number = 0;
        let ratingB: number = 0;

        players.forEach(p => {
             const maxLen = Math.ceil(players.length/2);
             if (newA.length < maxLen && newB.length < maxLen) {
                 if (ratingA <= ratingB) {
                     newA.push(String(p.steam_id));
                     ratingA += Number(p.hltv_3_0_score);
                 } else {
                     newB.push(String(p.steam_id));
                     ratingB += Number(p.hltv_3_0_score);
                 }
             } else if (newA.length < maxLen) {
                 newA.push(String(p.steam_id));
                 ratingA += Number(p.hltv_3_0_score);
             } else {
                 newB.push(String(p.steam_id));
                 ratingB += Number(p.hltv_3_0_score);
             }
        });
        
        setTeamA(newA);
        setTeamB(newB);
    };

    const getTeamStats = (ids: string[]) => {
        const players = ids.map(id => allPlayers.find(p => String(p.steam_id) === id)).filter(Boolean) as AggregatedPlayerStats[];
        const count = players.length;
        if (count === 0) return { avgRating: '0.00', avgAdr: '0.0', avgKpr: '0.00', players: [] };

        const avgRating = (players.reduce((a: number, b) => a + b.hltv_3_0_score, 0) / count).toFixed(2);
        const avgAdr = (players.reduce((a: number, b) => a + (b.damage_total / b.rounds_played), 0) / count).toFixed(1);
        const avgKpr = (players.reduce((a: number, b) => a + (b.kills / b.rounds_played), 0) / count).toFixed(2);
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

// --- Settings ---
const Settings: React.FC = () => {
    const { addMatches, deleteMatches, matches, clearAllData, deleteMatch } = useStats();
    const { isAdmin, login, logout } = useAuth();
    const { notify } = useNotification();
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [fileEditId, setFileEditId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return;
        setLoading(true);
        // Explicitly type files to avoid 'unknown' inference
        const files: File[] = Array.from(e.target.files);
        const newMatches: Match[] = [];

        for (const file of files) {
            try {
                if (file.name.endsWith('.json')) {
                    const text = await file.text();
                    const data = JSON.parse(text);
                    const normalized = normalizeImportedData(data, file.name);
                    if (normalized) newMatches.push(normalized);
                } else if (file.name.endsWith('.zip')) {
                    const zip = await JSZip.loadAsync(file);
                    for (const filename of Object.keys(zip.files)) {
                        if (filename.endsWith('.json')) {
                            const text = await zip.files[filename].async('text');
                            const data = JSON.parse(text);
                            const normalized = normalizeImportedData(data, filename);
                            if (normalized) newMatches.push(normalized);
                        }
                    }
                }
            } catch (err) {
                console.error("Error parsing file", file.name, err);
                notify('error', `Error parsing ${file.name}`);
            }
        }

        if (newMatches.length > 0) {
            await addMatches(newMatches);
        }
        setLoading(false);
        e.target.value = '';
    };

    const handleDeleteAll = async () => {
        if (confirm("Are you sure? This cannot be undone.")) {
            setIsDeleting(true);
            await deleteMatches(matches.map(m => m.id));
            setIsDeleting(false);
        }
    };
    
    const handleEditStart = (m: Match) => {
        setFileEditId(m.id);
        // Reconstruct a simplified JSON for editing, or just use current data
        // Ideally we store raw, but here we only have processed. We will edit processed data structure.
        setEditContent(JSON.stringify(m.data, null, 2));
    };
    
    const handleEditSave = async () => {
        if(!fileEditId) return;
        try {
            const data = JSON.parse(editContent);
            const m = matches.find(x => x.id === fileEditId);
            if(m) {
               // We need to re-normalize to ensure types, or just trust the admin edits
               // Re-using normalize might break if the edited structure is partial.
               // Let's assume the admin knows the PlayerStats structure.
               const updatedMatch = { ...m, data };
               await addMatches([updatedMatch]);
               notify('success', 'Match updated');
            }
            setFileEditId(null);
        } catch(e) {
            notify('error', 'Invalid JSON');
        }
    };

    if (!isAdmin) {
        return (
            <div className="flex items-center justify-center h-full p-4">
                <div className="bg-app-card p-8 rounded-xl border border-app-cardHover max-w-sm w-full text-center space-y-4">
                    <Shield className="w-12 h-12 text-app-accent mx-auto" />
                    <h2 className="text-xl font-bold">Admin Access</h2>
                    <input type="password" placeholder="Enter Password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-white" />
                    <button onClick={() => login(password) ? notify('success', 'Welcome Admin') : notify('error', 'Wrong Password')} className="w-full bg-app-accent hover:bg-app-accentHover text-white font-bold py-2 rounded transition-colors">Login</button>
                </div>
            </div>
        );
    }

    if (fileEditId) {
        return (
            <div className="p-6 h-full flex flex-col">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold flex items-center gap-2"><FilePenLine/> Edit Match Data</h2>
                    <div className="flex gap-2">
                        <button onClick={handleEditSave} className="bg-app-success hover:bg-green-600 px-4 py-2 rounded text-white flex items-center gap-2"><Save size={16}/> Save</button>
                        <button onClick={() => setFileEditId(null)} className="bg-zinc-700 hover:bg-zinc-600 px-4 py-2 rounded text-white">Cancel</button>
                    </div>
                </div>
                <textarea 
                    className="flex-1 w-full bg-zinc-950 font-mono text-sm p-4 rounded-xl border border-zinc-800 focus:border-app-accent outline-none resize-none"
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                />
            </div>
        )
    }

    return (
        <div className="p-4 md:p-6 space-y-6 pb-20 md:pb-6 animate-fade-in">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold flex items-center gap-2"><UserCog/> Settings</h2>
                <button onClick={logout} className="flex items-center gap-2 text-red-400 hover:text-red-300 px-3 py-1 border border-red-900/50 rounded hover:bg-red-900/10"><LogOut size={16}/> Logout</button>
            </div>

            <div className="bg-app-card p-6 rounded-xl border border-app-cardHover">
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><Upload/> Import Matches</h3>
                <div className="border-2 border-dashed border-zinc-700 rounded-xl p-8 text-center hover:border-app-accent hover:bg-app-accent/5 transition-all cursor-pointer relative group">
                    <input type="file" multiple accept=".json,.zip" onChange={handleUpload} className="absolute inset-0 opacity-0 cursor-pointer" disabled={loading} />
                    {loading ? <RefreshCw className="w-8 h-8 mx-auto animate-spin text-app-accent"/> : <FileJson className="w-10 h-10 mx-auto text-app-textMuted group-hover:text-app-accent transition-colors"/>}
                    <p className="mt-4 text-sm text-app-textMuted group-hover:text-white transition-colors">
                        {loading ? 'Processing...' : 'Click to upload JSON or ZIP files'}
                    </p>
                    <p className="text-xs text-zinc-500 mt-2">Supports multiple files</p>
                </div>
            </div>

            <div className="bg-app-card p-6 rounded-xl border border-app-cardHover flex flex-col h-[500px]">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-lg flex items-center gap-2"><List/> Managed Matches ({matches.length})</h3>
                    <button 
                        onClick={handleDeleteAll} 
                        disabled={isDeleting || matches.length === 0}
                        className={`text-xs px-3 py-1 rounded border transition-colors flex items-center gap-1 ${isDeleting ? 'text-zinc-500 border-zinc-700' : 'text-red-400 border-red-900/50 hover:bg-red-900/20'}`}
                    >
                        {isDeleting ? <RefreshCw className="animate-spin w-3 h-3"/> : <Trash2 size={14}/>} 
                        {isDeleting ? 'Deleting...' : 'Delete All'}
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                    {matches.map(m => (
                        <div key={m.id} className="flex items-center justify-between p-3 bg-zinc-950 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
                            <span className="text-sm font-mono truncate max-w-[200px] md:max-w-md text-zinc-300">{m.filename}</span>
                            <div className="flex items-center gap-2">
                                <button onClick={() => handleEditStart(m)} className="p-2 text-zinc-500 hover:text-app-accent hover:bg-app-accent/10 rounded transition-colors"><Edit2 size={14}/></button>
                                <button onClick={() => deleteMatch(m.id)} className="p-2 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"><Trash2 size={14}/></button>
                            </div>
                        </div>
                    ))}
                    {matches.length === 0 && <div className="text-center text-app-textMuted py-10">No matches found. Upload some!</div>}
                </div>
            </div>
        </div>
    );
};

// --- Maps Leaderboard ---
const MapsLeaderboard: React.FC = () => {
    const { matches, allPlayers } = useStats();
    const [selectedMap, setSelectedMap] = useState<string>('');
    const [sort, setSort] = useState<{key: string, dir: 'asc'|'desc'}>({ key: 'rating', dir: 'desc' });

    // Extract unique maps
    const availableMaps = useMemo(() => {
        const maps = new Set(matches.map(m => formatMapName(m.filename)));
        return Array.from(maps).sort();
    }, [matches]);

    useEffect(() => {
        if (availableMaps.length > 0 && !selectedMap) {
            setSelectedMap(availableMaps[0]);
        }
    }, [availableMaps, selectedMap]);

    const mapStats = useMemo(() => {
        if (!selectedMap) return [];
        
        // Filter matches for this map
        const mapMatches = matches.filter(m => formatMapName(m.filename) === selectedMap);
        
        // Aggregate stats ONLY for these matches
        const playerMap = new Map<string, any>();
        
        mapMatches.forEach(match => {
             match.data.forEach(p => {
                 const id = String(p.steam_id);
                 const existing = playerMap.get(id);
                 const rating = calculateRating(p); // Use calculated rating helper
                 
                 if(existing) {
                     playerMap.set(id, {
                         ...existing,
                         matches: existing.matches + 1,
                         kills: existing.kills + p.kills,
                         deaths: existing.deaths + p.deaths,
                         assists: existing.assists + p.assists,
                         damage: existing.damage + p.damage_total,
                         rounds: existing.rounds + p.rounds_played,
                         ratingSum: existing.ratingSum + rating,
                         name: p.name 
                     })
                 } else {
                     playerMap.set(id, {
                         id,
                         name: p.name,
                         matches: 1,
                         kills: p.kills,
                         deaths: p.deaths,
                         assists: p.assists,
                         damage: p.damage_total,
                         rounds: p.rounds_played,
                         ratingSum: rating
                     })
                 }
             });
        });
        
        return Array.from(playerMap.values()).map(p => ({
            ...p,
            rating: p.ratingSum / p.matches,
            adr: p.damage / p.rounds,
            kpr: p.kills / p.rounds,
            kd: p.deaths > 0 ? p.kills / p.deaths : p.kills
        }));

    }, [matches, selectedMap]);

    const sortedStats = useMemo(() => {
        return [...mapStats].sort((a,b) => {
            const valA = a[sort.key as keyof typeof a];
            const valB = b[sort.key as keyof typeof b];
            if (typeof valA === 'number' && typeof valB === 'number') {
                return sort.dir === 'asc' ? valA - valB : valB - valA;
            }
            return 0;
        });
    }, [mapStats, sort]);

    const handleSort = (key: string) => {
        setSort(prev => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
    };

    return (
        <div className="p-4 md:p-6 h-full flex flex-col pb-20 md:pb-6 animate-fade-in">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                 <h2 className="text-2xl font-bold flex items-center gap-2"><MapIcon/> Map Leaderboard</h2>
                 <div className="relative w-full md:w-64">
                     <select 
                        value={selectedMap} 
                        onChange={e => setSelectedMap(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-700 text-white rounded-lg p-2.5 appearance-none focus:border-app-accent outline-none"
                     >
                         {availableMaps.map(m => <option key={m} value={m}>{m}</option>)}
                     </select>
                     <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-zinc-500 pointer-events-none"/>
                 </div>
            </div>

            <div className="bg-app-card border border-app-cardHover rounded-xl overflow-hidden shadow-lg flex-1 flex flex-col">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-zinc-900/50 text-app-textMuted font-medium uppercase text-xs tracking-wider">
                            <tr>
                                <th className="p-4">Player</th>
                                <th className="p-4 text-center cursor-pointer hover:text-white" onClick={() => handleSort('matches')}>Matches</th>
                                <th className="p-4 text-center cursor-pointer hover:text-white" onClick={() => handleSort('rating')}>Rating</th>
                                <th className="p-4 text-center cursor-pointer hover:text-white" onClick={() => handleSort('adr')}>ADR</th>
                                <th className="p-4 text-center cursor-pointer hover:text-white" onClick={() => handleSort('kd')}>K/D</th>
                                <th className="p-4 text-center cursor-pointer hover:text-white" onClick={() => handleSort('kpr')}>KPR</th>
                                <th className="p-4 text-center cursor-pointer hover:text-white" onClick={() => handleSort('kills')}>Kills</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800">
                            {sortedStats.map((p, i) => (
                                <tr key={p.id} className="hover:bg-zinc-800/50 transition-colors">
                                    <td className="p-4 font-medium text-white flex items-center gap-3">
                                        <span className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold ${i < 3 ? 'bg-app-accent/20 text-app-accent' : 'bg-zinc-800 text-zinc-500'}`}>{i+1}</span>
                                        {p.name}
                                    </td>
                                    <td className="p-4 text-center text-zinc-400">{p.matches}</td>
                                    <td className={`p-4 text-center font-bold ${p.rating >= 1.2 ? 'text-app-success' : p.rating >= 1.0 ? 'text-app-warning' : 'text-app-danger'}`}>{p.rating.toFixed(2)}</td>
                                    <td className="p-4 text-center text-zinc-300">{p.adr.toFixed(1)}</td>
                                    <td className={`p-4 text-center ${p.kd >= 1 ? 'text-green-400' : 'text-red-400'}`}>{p.kd.toFixed(2)}</td>
                                    <td className="p-4 text-center text-zinc-400">{p.kpr.toFixed(2)}</td>
                                    <td className="p-4 text-center text-zinc-300">{p.kills}</td>
                                </tr>
                            ))}
                            {sortedStats.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="p-8 text-center text-zinc-500">No data available for this map.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// --- Match Details ---
const MatchDetails: React.FC<{ match: Match, onBack: () => void }> = ({ match, onBack }) => {
    const formatTime = (ts: number) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const mapName = formatMapName(match.filename);

    // Split players into Team A (CT usually) and Team B (T usually) or just grouped by side
    const teamA = match.data.filter(p => p.last_team_name === 'CT' || p.last_side === 'CT' || p.last_team_name === 'Team A');
    const teamB = match.data.filter(p => p.last_team_name === 'T' || p.last_side === 'T' || p.last_team_name === 'Team B');
    
    // Fallback if no teams detected, just split by index
    const unassigned = match.data.filter(p => !teamA.includes(p) && !teamB.includes(p));
    if (teamA.length === 0 && teamB.length === 0) {
        // Simple split
        const half = Math.ceil(match.data.length / 2);
        teamA.push(...match.data.slice(0, half));
        teamB.push(...match.data.slice(half));
    } else {
        teamA.push(...unassigned.slice(0, Math.ceil(unassigned.length/2)));
        teamB.push(...unassigned.slice(Math.ceil(unassigned.length/2)));
    }

    const renderTeamTable = (teamName: string, players: PlayerStats[], colorClass: string) => (
        <div className="bg-app-card rounded-xl border border-app-cardHover overflow-hidden shadow-lg mb-6">
            <div className={`p-4 border-b border-app-cardHover ${colorClass} bg-opacity-10`}>
                <h3 className={`font-bold text-lg ${colorClass.replace('bg-', 'text-').replace('/10', '')}`}>{teamName}</h3>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-zinc-950/50 text-xs uppercase text-app-textMuted font-medium tracking-wider">
                        <tr>
                            <th className="p-3">Player</th>
                            <th className="p-3 text-center">K</th>
                            <th className="p-3 text-center">D</th>
                            <th className="p-3 text-center">A</th>
                            <th className="p-3 text-center">+/-</th>
                            <th className="p-3 text-center">ADR</th>
                            <th className="p-3 text-center">HS%</th>
                            <th className="p-3 text-center">EF</th>
                            <th className="p-3 text-center">R</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                        {players.sort((a,b) => (b.hltv_3_0_score || 0) - (a.hltv_3_0_score || 0)).map(p => {
                            const rating = calculateRating(p);
                            const hsPerc = p.kills > 0 ? Math.round(((p.headshot_kills || 0)/p.kills)*100) : 0;
                            return (
                                <tr key={p.steam_id} className="hover:bg-zinc-800/30">
                                    <td className="p-3 font-medium text-white">{p.name}</td>
                                    <td className="p-3 text-center text-zinc-300">{p.kills}</td>
                                    <td className="p-3 text-center text-red-400/80">{p.deaths}</td>
                                    <td className="p-3 text-center text-zinc-500">{p.assists}</td>
                                    <td className={`p-3 text-center font-bold ${p.kills - p.deaths >= 0 ? 'text-green-400' : 'text-red-400'}`}>{p.kills - p.deaths}</td>
                                    <td className="p-3 text-center text-zinc-300">{(p.adr || (p.damage_total/p.rounds_played)).toFixed(1)}</td>
                                    <td className="p-3 text-center text-zinc-400">{hsPerc}%</td>
                                    <td className="p-3 text-center text-zinc-400">{p.enemies_flashed}</td>
                                    <td className={`p-3 text-center font-bold ${rating >= 1.2 ? 'text-app-accent' : rating < 1.0 ? 'text-zinc-500' : 'text-white'}`}>{rating.toFixed(2)}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );

    return (
        <div className="p-4 md:p-6 h-full flex flex-col pb-20 md:pb-6 animate-fade-in overflow-y-auto">
            <button onClick={onBack} className="mb-4 flex items-center gap-2 text-app-textMuted hover:text-white transition-colors w-fit">
                <ArrowLeft size={18}/> Back to Matches
            </button>
            
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800">
                <div>
                    <h1 className="text-3xl md:text-5xl font-black text-white tracking-tighter mb-2">{mapName}</h1>
                    <div className="flex items-center gap-4 text-app-textMuted text-sm">
                        <span className="flex items-center gap-1"><Calendar size={14}/> {formatTime(match.timestamp)}</span>
                        <span className="flex items-center gap-1"><Users size={14}/> {match.data.length} Players</span>
                    </div>
                </div>
                <div className="mt-4 md:mt-0 px-4 py-2 bg-app-accent/10 border border-app-accent/20 rounded-lg text-app-accent font-bold">
                    Finished
                </div>
            </div>

            <div className="space-y-2">
                {renderTeamTable('Counter-Terrorists', teamA, 'bg-blue-500')}
                {renderTeamTable('Terrorists', teamB, 'bg-orange-500')}
            </div>
        </div>
    );
};

// --- Matches List ---
const MatchesList: React.FC<{ onSelect: (m: Match) => void }> = ({ onSelect }) => {
    const { matches, loading } = useStats();
    const [search, setSearch] = useState('');
    const [view, setView] = useState<'grid'|'list'|'chart'>('grid');
    const [sort, setSort] = useState<'date'|'map'|'players'|'kills'>('date');
    const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');

    const filteredMatches = useMemo(() => {
        let filtered = matches.filter(m => 
            m.filename.toLowerCase().includes(search.toLowerCase()) || 
            formatMapName(m.filename).toLowerCase().includes(search.toLowerCase())
        );

        return filtered.sort((a,b) => {
            let valA: any = a.timestamp;
            let valB: any = b.timestamp;

            if (sort === 'map') {
                valA = formatMapName(a.filename);
                valB = formatMapName(b.filename);
                return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            if (sort === 'players') {
                valA = a.data.length;
                valB = b.data.length;
            }
            if (sort === 'kills') {
                valA = a.data.reduce((acc, p) => acc + p.kills, 0);
                valB = b.data.reduce((acc, p) => acc + p.kills, 0);
            }
            // default date
            if (sort === 'date') {
                 return sortDir === 'asc' ? valA - valB : valB - valA;
            }

            return sortDir === 'asc' ? (valA as any) - (valB as any) : (valB as any) - (valA as any);
        });
    }, [matches, search, sort, sortDir]);

    const chartData = useMemo(() => {
        const mapCounts: Record<string, number> = {};
        matches.forEach(m => {
            const map = formatMapName(m.filename);
            mapCounts[map] = (mapCounts[map] || 0) + 1;
        });
        const colors = ['#38bdf8', '#8b5cf6', '#f472b6', '#fb923c', '#4ade80', '#fbbf24', '#94a3b8'];
        return Object.entries(mapCounts).map(([name, value], i) => ({
            label: name,
            value,
            color: colors[i % colors.length]
        })).sort((a,b) => b.value - a.value);
    }, [matches]);

    if (loading) return <div className="h-full flex items-center justify-center text-app-accent"><RefreshCw className="animate-spin w-8 h-8"/></div>;

    return (
        <div className="p-4 md:p-6 h-full flex flex-col pb-20 md:pb-6 animate-fade-in">
             <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                 <h2 className="text-2xl font-bold flex items-center gap-2"><Gamepad2/> Recent Matches</h2>
                 
                 <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                     <div className="relative">
                         <Search className="absolute left-3 top-2.5 w-4 h-4 text-app-textMuted"/>
                         <input 
                            type="text" 
                            placeholder="Search matches..." 
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full md:w-64 bg-zinc-900 border border-zinc-700 rounded-lg pl-9 pr-4 py-2 text-sm focus:border-app-accent outline-none text-white"
                         />
                     </div>
                     <div className="flex items-center gap-2 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
                         <button onClick={() => setView('grid')} className={`p-1.5 rounded ${view === 'grid' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'}`}><LayoutGrid size={18}/></button>
                         <button onClick={() => setView('list')} className={`p-1.5 rounded ${view === 'list' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'}`}><List size={18}/></button>
                         <button onClick={() => setView('chart')} className={`p-1.5 rounded ${view === 'chart' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'}`}><PieChart size={18}/></button>
                     </div>
                     <div className="flex gap-2">
                         <select 
                            value={sort} 
                            onChange={(e:any) => setSort(e.target.value)}
                            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-app-accent"
                         >
                             <option value="date">Date</option>
                             <option value="map">Map</option>
                             <option value="players">Players</option>
                             <option value="kills">Total Kills</option>
                         </select>
                         <button onClick={() => setSortDir(p => p === 'asc' ? 'desc' : 'asc')} className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 text-white hover:bg-zinc-800">
                             {sortDir === 'asc' ? <ArrowUp size={16}/> : <ArrowDown size={16}/>}
                         </button>
                     </div>
                 </div>
             </div>

             {view === 'chart' ? (
                 <div className="bg-app-card rounded-xl border border-app-cardHover flex-1 flex flex-col items-center justify-center p-6">
                     <h3 className="text-xl font-bold mb-4">Map Distribution</h3>
                     <SimplePieChart data={chartData} />
                 </div>
             ) : (
                <div className={`flex-1 overflow-y-auto ${view === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4' : 'space-y-2'}`}>
                    {filteredMatches.map(m => {
                        const totalKills = m.data.reduce((acc, p) => acc + p.kills, 0);
                        return view === 'grid' ? (
                            <div key={m.id} onClick={() => onSelect(m)} className="bg-app-card border border-app-cardHover rounded-xl p-5 cursor-pointer hover:border-app-accent/50 hover:bg-zinc-800 transition-all group flex flex-col justify-between h-40 relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                    <Swords size={64}/>
                                </div>
                                <div className="flex justify-between items-start z-10">
                                    <Swords className="text-app-accent w-5 h-5"/>
                                    <span className="text-xs text-app-textMuted font-mono">{new Date(m.timestamp).toLocaleDateString()}</span>
                                </div>
                                <div className="z-10 mt-2">
                                    <h3 className="text-xl font-bold text-white group-hover:text-app-accent transition-colors">{formatMapName(m.filename)}</h3>
                                    <div className="flex gap-4 mt-3 text-xs text-app-textMuted">
                                        <span className="flex items-center gap-1"><Users size={12}/> {m.data.length} Players</span>
                                        <span className="flex items-center gap-1"><Crosshair size={12}/> {totalKills} Kills</span>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div key={m.id} onClick={() => onSelect(m)} className="bg-app-card border border-app-cardHover rounded-lg p-4 cursor-pointer hover:border-app-accent/50 hover:bg-zinc-800 transition-all flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="bg-app-accent/10 p-2 rounded-lg text-app-accent"><MapIcon size={20}/></div>
                                    <div>
                                        <div className="font-bold text-white">{formatMapName(m.filename)}</div>
                                        <div className="text-xs text-app-textMuted">{new Date(m.timestamp).toLocaleString()}</div>
                                    </div>
                                </div>
                                <div className="flex gap-6 text-sm text-zinc-400">
                                     <div className="flex flex-col items-end">
                                        <span className="text-xs uppercase tracking-wider text-zinc-600">Players</span>
                                        <span className="font-mono text-white">{m.data.length}</span>
                                     </div>
                                     <div className="flex flex-col items-end w-16">
                                        <span className="text-xs uppercase tracking-wider text-zinc-600">Kills</span>
                                        <span className="font-mono text-white">{totalKills}</span>
                                     </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
             )}
        </div>
    );
};

// --- Player Profile ---
const PlayerProfile: React.FC<{ playerId: string, onBack: () => void }> = ({ playerId, onBack }) => {
    const { allPlayers, matches } = useStats();
    const [showAllMatches, setShowAllMatches] = useState(false);

    const player = allPlayers.find(p => String(p.steam_id) === playerId);
    
    if (!player) return <div>Player not found</div>;

    // Get matches for this player
    const playerMatches = useMemo(() => matches
        .filter(m => m.data.some(p => String(p.steam_id) === playerId))
        .sort((a,b) => b.timestamp - a.timestamp), [matches, playerId]);

    const displayedMatches = showAllMatches ? playerMatches : playerMatches.slice(0, 5);

    // Calculate Best Teammate
    const bestTeammate = useMemo(() => {
        const teammateStats: Record<string, { name: string, matches: number, ratingSum: number }> = {};
        
        playerMatches.forEach(match => {
             const me = match.data.find(p => String(p.steam_id) === playerId);
             if (!me) return;
             
             // Identify teammates
             const teammates = match.data.filter(p => 
                 String(p.steam_id) !== playerId && 
                 (p.last_team_name === me.last_team_name || p.last_side === me.last_side)
             );
             
             teammates.forEach(tm => {
                 const tmId = String(tm.steam_id);
                 if (!teammateStats[tmId]) teammateStats[tmId] = { name: tm.name, matches: 0, ratingSum: 0 };
                 teammateStats[tmId].matches += 1;
                 teammateStats[tmId].ratingSum += (typeof tm.hltv_3_0_score === 'number' ? tm.hltv_3_0_score : 0);
             });
        });

        const sorted = Object.values(teammateStats).sort((a,b) => b.matches - a.matches);
        return sorted.length > 0 ? sorted[0] : null;
    }, [playerMatches, playerId]);

    // Calculate Top Weapons
    const topWeapons = useMemo(() => {
        if (!player.weapon_stats) return [];
        return Object.entries(player.weapon_stats)
            .map(([name, count]) => ({ name, count }))
            .sort((a,b) => b.count - a.count)
            .slice(0, 3);
    }, [player]);

    // Calculate Best Maps
    const bestMaps = useMemo(() => {
        const stats: Record<string, number> = {};
        playerMatches.forEach(m => {
            const map = formatMapName(m.filename);
            stats[map] = (stats[map] || 0) + 1;
        });
        return Object.entries(stats)
            .sort((a,b) => b[1] - a[1])
            .slice(0, 3)
            .map(([name, count]) => ({ name, count }));
    }, [playerMatches]);

    // Calculate Top Rivals (Most Duels)
    const topRivals = useMemo(() => {
        const stats: Record<string, { name: string, kills: number, deaths: number, total: number }> = {};
        
        playerMatches.forEach(m => {
            const pStats = m.data.find(p => String(p.steam_id) === playerId);
            if(!pStats || !pStats.duels) return;

            Object.entries(pStats.duels).forEach(([oid, d]: [string, any]) => {
                let name = d.opponent_name || oid;
                // Try to find name in match data if it looks like an ID
                if (name === oid) {
                    const opp = m.data.find(p => String(p.steam_id) === oid);
                    if (opp) name = opp.name;
                }

                if (!stats[oid]) stats[oid] = { name, kills: 0, deaths: 0, total: 0 };
                stats[oid].kills += d.kills;
                stats[oid].deaths += d.deaths;
                stats[oid].total += (d.kills + d.deaths);
                if (name !== oid) stats[oid].name = name;
            });
        });

        return Object.values(stats)
            .sort((a,b) => b.total - a.total)
            .slice(0, 3);
    }, [playerMatches, playerId]);

    return (
        <div className="p-4 md:p-6 h-full flex flex-col pb-20 md:pb-6 animate-fade-in overflow-y-auto">
            <button onClick={onBack} className="mb-4 flex items-center gap-2 text-app-textMuted hover:text-white transition-colors w-fit">
                <ArrowLeft size={18}/> Back
            </button>

            {/* Profile Header */}
            <div className="flex items-center gap-6 mb-8">
                <div className="w-20 h-20 bg-gradient-to-br from-app-accent to-purple-500 rounded-2xl flex items-center justify-center text-3xl font-bold text-white shadow-lg shadow-app-accent/20">
                    {player.name.charAt(0).toUpperCase()}
                </div>
                <div>
                    <h1 className="text-3xl font-black text-white">{player.name}</h1>
                    <div className="flex gap-4 text-app-textMuted text-sm mt-1">
                        <span>{player.matches} Matches</span>
                        <span>•</span>
                        <span>{player.rounds_played} Rounds</span>
                    </div>
                </div>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-app-card p-4 rounded-xl border border-app-cardHover">
                    <div className="text-app-textMuted text-xs uppercase font-bold mb-1">Rating 2.0</div>
                    <div className="text-2xl font-black text-app-accent">{player.hltv_3_0_score.toFixed(2)}</div>
                </div>
                 <div className="bg-app-card p-4 rounded-xl border border-app-cardHover">
                    <div className="text-app-textMuted text-xs uppercase font-bold mb-1">ADR</div>
                    <div className="text-2xl font-black text-white">{(player.damage_total/player.rounds_played).toFixed(1)}</div>
                </div>
                 <div className="bg-app-card p-4 rounded-xl border border-app-cardHover">
                    <div className="text-app-textMuted text-xs uppercase font-bold mb-1">K/D Ratio</div>
                    <div className="text-2xl font-black text-green-400">{(player.kills/player.deaths).toFixed(2)}</div>
                </div>
                 <div className="bg-app-card p-4 rounded-xl border border-app-cardHover">
                    <div className="text-app-textMuted text-xs uppercase font-bold mb-1">Headshot %</div>
                    <div className="text-2xl font-black text-white">{Math.round((player.headshot_kills/player.kills)*100)}%</div>
                </div>
            </div>

            {/* Recent Performance with Styled Toggle Button */}
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-xl">Recent Performance</h3>
                 {playerMatches.length > 5 && (
                     <button 
                        onClick={() => setShowAllMatches(!showAllMatches)}
                        className="bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold py-1.5 px-4 rounded-lg border border-zinc-700 transition-colors flex items-center gap-2"
                     >
                        {showAllMatches ? (
                            <>
                                <ChevronUp size={14} /> Show Less
                            </>
                        ) : (
                            <>
                                <ChevronDown size={14} /> View All Matches
                            </>
                        )}
                     </button>
                 )}
            </div>
            
            <div className="space-y-2 mb-8">
                {displayedMatches.map(m => {
                    const pStats = m.data.find(p => String(p.steam_id) === playerId);
                    if(!pStats) return null;
                    const rating = calculateRating(pStats);
                    return (
                        <div key={m.id} className="bg-zinc-900/50 p-4 rounded-lg flex items-center justify-between border border-zinc-800">
                             <div className="flex items-center gap-4">
                                 <div className={`font-bold text-lg w-12 text-center ${rating >= 1.2 ? 'text-app-accent' : rating < 1 ? 'text-red-400' : 'text-white'}`}>{rating.toFixed(2)}</div>
                                 <div>
                                     <div className="font-medium text-white">{formatMapName(m.filename)}</div>
                                     <div className="text-xs text-app-textMuted">{new Date(m.timestamp).toLocaleDateString()}</div>
                                 </div>
                             </div>
                             <div className="flex gap-4 text-sm">
                                 <div className="text-right">
                                     <div className="text-zinc-500 text-xs">K-D</div>
                                     <div className={`font-mono ${pStats.kills - pStats.deaths >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pStats.kills}-{pStats.deaths}</div>
                                 </div>
                                  <div className="text-right w-12">
                                     <div className="text-zinc-500 text-xs">ADR</div>
                                     <div className="font-mono text-zinc-300">{(pStats.adr || (pStats.damage_total/pStats.rounds_played)).toFixed(0)}</div>
                                 </div>
                             </div>
                        </div>
                    );
                })}
            </div>

            {/* Combat Records Section */}
            <div className="animate-fade-in">
                <h3 className="font-bold text-xl mb-4 flex items-center gap-2"><Swords className="text-red-400"/> Combat Records</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Best Teammate (Left) */}
                    <div className="bg-zinc-900/50 p-6 rounded-xl border border-zinc-800 flex items-center gap-4 relative overflow-hidden group">
                         <div className="absolute right-0 top-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity"><Users2 size={100}/></div>
                         <div className="w-12 h-12 bg-app-accent/20 rounded-full flex items-center justify-center text-app-accent">
                             <Crown size={24} />
                         </div>
                         <div className="z-10">
                             <div className="text-zinc-500 text-xs uppercase font-bold mb-1">Best Teammate</div>
                             {bestTeammate ? (
                                 <>
                                    <div className="font-black text-xl text-white">{bestTeammate.name}</div>
                                    <div className="text-app-textMuted text-sm mt-1">
                                        Played <span className="text-white font-bold">{bestTeammate.matches}</span> matches together
                                    </div>
                                 </>
                             ) : (
                                 <div className="text-zinc-500 italic">No teammates found</div>
                             )}
                         </div>
                    </div>

                    {/* Top 3 Weapons (Right) */}
                    <div className="bg-zinc-900/50 p-6 rounded-xl border border-zinc-800 relative overflow-hidden group">
                         <div className="absolute right-0 top-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity"><Crosshair size={100}/></div>
                         <div className="flex items-center gap-2 mb-3 z-10 relative">
                             <Crosshair size={16} className="text-orange-500"/>
                             <span className="text-zinc-500 text-xs uppercase font-bold">Top Weapons</span>
                         </div>
                         <div className="space-y-3 z-10 relative">
                             {topWeapons.length > 0 ? topWeapons.map((w, i) => (
                                 <div key={w.name} className="flex items-center justify-between">
                                     <div className="flex items-center gap-2">
                                         <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${i===0 ? 'bg-yellow-500 text-black' : 'bg-zinc-800 text-zinc-500'}`}>{i+1}</div>
                                         <span className="text-white font-medium capitalize">{w.name}</span>
                                     </div>
                                     <span className="text-zinc-400 font-mono text-sm">{w.count} Kills</span>
                                 </div>
                             )) : (
                                 <div className="text-zinc-500 italic">No weapon stats available</div>
                             )}
                         </div>
                    </div>

                    {/* Best Maps (Left - New) */}
                    <div className="bg-zinc-900/50 p-6 rounded-xl border border-zinc-800 relative overflow-hidden group">
                         <div className="absolute right-0 top-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity"><MapIcon size={100}/></div>
                         <div className="flex items-center gap-2 mb-3 z-10 relative">
                             <MapIcon size={16} className="text-blue-400"/>
                             <span className="text-zinc-500 text-xs uppercase font-bold">Best Maps</span>
                         </div>
                         <div className="space-y-3 z-10 relative">
                             {bestMaps.length > 0 ? bestMaps.map((m, i) => (
                                 <div key={m.name} className="flex items-center justify-between">
                                     <div className="flex items-center gap-2">
                                         <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${i===0 ? 'bg-blue-500 text-white' : 'bg-zinc-800 text-zinc-500'}`}>{i+1}</div>
                                         <span className="text-white font-medium">{m.name}</span>
                                     </div>
                                     <span className="text-zinc-400 font-mono text-sm">{m.count} Matches</span>
                                 </div>
                             )) : (
                                 <div className="text-zinc-500 italic">No map data available</div>
                             )}
                         </div>
                    </div>

                    {/* Top Rivals (Right - New) */}
                    <div className="bg-zinc-900/50 p-6 rounded-xl border border-zinc-800 relative overflow-hidden group">
                         <div className="absolute right-0 top-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity"><Swords size={100}/></div>
                         <div className="flex items-center gap-2 mb-3 z-10 relative">
                             <Swords size={16} className="text-red-400"/>
                             <span className="text-zinc-500 text-xs uppercase font-bold">Top Rivals</span>
                         </div>
                         <div className="space-y-3 z-10 relative">
                             {topRivals.length > 0 ? topRivals.map((r, i) => (
                                 <div key={r.name} className="flex items-center justify-between">
                                     <div className="flex items-center gap-2">
                                         <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${i===0 ? 'bg-red-500 text-white' : 'bg-zinc-800 text-zinc-500'}`}>{i+1}</div>
                                         <span className="text-white font-medium truncate max-w-[100px]">{r.name}</span>
                                     </div>
                                     <div className="text-right">
                                         <div className="text-zinc-400 font-mono text-sm">{r.total} Duels</div>
                                         <div className="text-xs text-zinc-600 font-mono">{r.kills} - {r.deaths}</div>
                                     </div>
                                 </div>
                             )) : (
                                 <div className="text-zinc-500 italic">No duel data available</div>
                             )}
                         </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Dashboard (Main Leaderboard) ---
const Dashboard: React.FC<{ onSelectPlayer: (id: string) => void }> = ({ onSelectPlayer }) => {
    const { allPlayers, matches, loading } = useStats();
    const [search, setSearch] = useState('');
    const [statsMode, setStatsMode] = useState<'avg'|'total'>('avg');
    const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'hltv_3_0_score', direction: 'desc' });

    const handleSort = (key: string) => {
        setSortConfig(current => {
            if (current?.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
            return { key, direction: 'desc' };
        });
    };

    // Calculate General Stats Summary
    const stats = useMemo(() => {
        const totalKills = matches.reduce((acc: number, m) => acc + m.data.reduce((pAcc: number, p) => pAcc + p.kills, 0), 0);
        const totalMaps = matches.length;

        // Top 3 Players by Rating
        const topPlayers = [...allPlayers]
            .sort((a, b) => b.hltv_3_0_score - a.hltv_3_0_score)
            .slice(0, 3);

        // Top 3 Weapons
        const weaponCounts: Record<string, number> = {};
        allPlayers.forEach(p => {
            Object.entries(p.weapon_stats).forEach(([w, count]) => {
                weaponCounts[w] = (weaponCounts[w] || 0) + (count as number);
            });
        });
        const topWeapons = Object.entries(weaponCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([name, count]) => ({ name, count }));

        // Top 3 Maps
        const mapCounts: Record<string, number> = {};
        matches.forEach(m => {
            const map = formatMapName(m.filename);
            mapCounts[map] = (mapCounts[map] || 0) + 1;
        });
        const topMaps = Object.entries(mapCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([name, count]) => ({ name, count }));

        return { totalKills, totalMaps, topPlayers, topWeapons, topMaps };
    }, [matches, allPlayers]);


    const sortedPlayers = useMemo(() => {
        let players = [...allPlayers];
        if (search) players = players.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

        if (sortConfig) {
            players.sort((a: any, b: any) => {
                let aVal = a[sortConfig.key];
                let bVal = b[sortConfig.key];

                // Dynamic calculation for avg fields if needed
                if (statsMode === 'avg') {
                     if (['kills', 'deaths', 'assists', 'damage_total', 'sniper_kills', 'opening_kills'].includes(sortConfig.key)) {
                         aVal = a[sortConfig.key] / a.rounds_played; // Per round stats mostly, or matches
                         bVal = b[sortConfig.key] / b.rounds_played;
                         if (sortConfig.key === 'damage_total') { // ADR
                             aVal = a.damage_total / a.rounds_played;
                             bVal = b.damage_total / b.rounds_played;
                         }
                     }
                }
                
                // Specific manual overrides
                if (sortConfig.key === 'adr') {
                    aVal = a.damage_total / a.rounds_played;
                    bVal = b.damage_total / b.rounds_played;
                }
                if (sortConfig.key === 'hs_percent') {
                     aVal = a.kills > 0 ? a.headshot_kills / a.kills : 0;
                     bVal = b.kills > 0 ? b.headshot_kills / b.kills : 0;
                }
                if (sortConfig.key === 'kpr') {
                    aVal = a.kills / a.rounds_played;
                    bVal = b.kills / b.rounds_played;
                }

                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return players;
    }, [allPlayers, search, sortConfig, statsMode]);

    if (loading) return <div className="h-full flex items-center justify-center text-app-accent"><RefreshCw className="animate-spin w-8 h-8"/></div>;

    return (
        <div className="p-4 md:p-6 h-full flex flex-col pb-20 md:pb-6 animate-fade-in overflow-y-auto">
            {/* Header / General Stats Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="bg-app-card/50 p-6 rounded-2xl border border-app-cardHover flex flex-col items-center justify-center text-center shadow-lg relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity"><Crosshair size={120}/></div>
                    <Crosshair className="w-10 h-10 text-app-accent mb-3"/>
                    <div className="text-4xl md:text-5xl font-black text-white tracking-tighter">{stats.totalKills.toLocaleString().replace(/,/g, ' ')}</div>
                    <div className="text-sm text-app-accent uppercase font-bold tracking-widest mt-1">Total Kills</div>
                </div>
                <div className="bg-app-card/50 p-6 rounded-2xl border border-app-cardHover flex flex-col items-center justify-center text-center shadow-lg relative overflow-hidden group">
                     <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity"><MapIcon size={120}/></div>
                    <MapIcon className="w-10 h-10 text-purple-400 mb-3"/>
                    <div className="text-4xl md:text-5xl font-black text-white tracking-tighter">{stats.totalMaps}</div>
                    <div className="text-sm text-purple-400 uppercase font-bold tracking-widest mt-1">Matches Played</div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                 {/* Top Players */}
                 <div className="bg-app-card/30 rounded-xl p-5 border border-app-cardHover/50">
                    <h3 className="flex items-center gap-2 font-bold text-lg mb-4 text-yellow-500">
                        <Crown size={20}/> Top Players
                    </h3>
                    <div className="space-y-3">
                        {stats.topPlayers.map((p, i) => (
                            <div key={p.steam_id} className="flex items-center justify-between p-3 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
                                <div className="flex items-center gap-3">
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i===0 ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/20' : i===1 ? 'bg-zinc-400 text-black' : 'bg-orange-700 text-white'}`}>
                                        {i+1}
                                    </div>
                                    <span className="font-medium text-white truncate max-w-[100px]">{p.name}</span>
                                </div>
                                <span className="font-mono font-bold text-app-accent">{p.hltv_3_0_score.toFixed(2)} R</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Weapons */}
                <div className="bg-app-card/30 rounded-xl p-5 border border-app-cardHover/50">
                     <h3 className="flex items-center gap-2 font-bold text-lg mb-4 text-red-400">
                        <Swords size={20}/> Best Weapons
                    </h3>
                    <div className="space-y-3">
                        {stats.topWeapons.map((w, i: number) => (
                            <div key={w.name} className="flex items-center justify-between p-3 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
                                <div className="flex items-center gap-3">
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i===0 ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/20' : i===1 ? 'bg-zinc-400 text-black' : 'bg-orange-700 text-white'}`}>
                                        {i+1}
                                    </div>
                                    <span className="font-medium text-white capitalize">{w.name}</span>
                                </div>
                                <span className="font-mono text-app-textMuted">{w.count}</span>
                            </div>
                        ))}
                    </div>
                </div>

                 {/* Maps */}
                 <div className="bg-app-card/30 rounded-xl p-5 border border-app-cardHover/50">
                     <h3 className="flex items-center gap-2 font-bold text-lg mb-4 text-blue-400">
                        <MapIcon size={20}/> Favorite Maps
                    </h3>
                    <div className="space-y-3">
                        {stats.topMaps.map((m, i) => (
                            <div key={m.name} className="flex items-center justify-between p-3 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
                                <div className="flex items-center gap-3">
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i===0 ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/20' : i===1 ? 'bg-zinc-400 text-black' : 'bg-orange-700 text-white'}`}>
                                        {i+1}
                                    </div>
                                    <span className="font-medium text-white">{m.name}</span>
                                </div>
                                <span className="font-mono text-app-textMuted">{m.count}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Leaderboard Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <h2 className="text-2xl font-bold flex items-center gap-2"><Trophy className="text-yellow-500"/> Leaderboard</h2>
                <div className="flex gap-4 w-full md:w-auto">
                    <div className="flex bg-zinc-900 rounded-lg p-1 border border-zinc-800">
                        <button onClick={() => setStatsMode('avg')} className={`px-3 py-1 text-xs font-bold rounded ${statsMode === 'avg' ? 'bg-app-accent text-white' : 'text-zinc-500 hover:text-white'}`}>Averages</button>
                        <button onClick={() => setStatsMode('total')} className={`px-3 py-1 text-xs font-bold rounded ${statsMode === 'total' ? 'bg-app-accent text-white' : 'text-zinc-500 hover:text-white'}`}>Totals</button>
                    </div>
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-2.5 w-4 h-4 text-app-textMuted"/>
                        <input 
                            type="text" 
                            placeholder="Search..." 
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-sm focus:border-app-accent outline-none text-white"
                        />
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="bg-app-card border border-app-cardHover rounded-xl overflow-hidden shadow-lg flex-1 flex flex-col min-h-[500px]">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-zinc-900/50 text-app-textMuted font-medium uppercase text-xs tracking-wider">
                            <tr>
                                <th className="p-4">#</th>
                                <th className="p-4">Player</th>
                                <th className="p-4 text-center cursor-pointer hover:text-white" onClick={() => handleSort('matches')}>Maps</th>
                                <th className="p-4 text-center cursor-pointer hover:text-white" onClick={() => handleSort('kills')}>{statsMode === 'avg' ? 'Avg K' : 'Kills'}</th>
                                <th className="p-4 text-center cursor-pointer hover:text-white" onClick={() => handleSort('deaths')}>{statsMode === 'avg' ? 'Avg D' : 'Deaths'}</th>
                                <th className="p-4 text-center cursor-pointer hover:text-white" onClick={() => handleSort('assists')}>{statsMode === 'avg' ? 'Avg A' : 'Assists'}</th>
                                <th className="p-4 text-center cursor-pointer hover:text-white" onClick={() => handleSort('kpr')}>KPR</th>
                                <th className="p-4 text-center cursor-pointer hover:text-white" onClick={() => handleSort('hs_percent')}>HS%</th>
                                <th className="p-4 text-center cursor-pointer hover:text-white" onClick={() => handleSort('adr')}>ADR</th>
                                <th className="p-4 text-center cursor-pointer hover:text-white" onClick={() => handleSort('hltv_3_0_score')}>Rating</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800">
                            {sortedPlayers.map((p, i) => {
                                const kVal = statsMode === 'avg' ? (p.kills / p.matches).toFixed(1) : p.kills;
                                const dVal = statsMode === 'avg' ? (p.deaths / p.matches).toFixed(1) : p.deaths;
                                const aVal = statsMode === 'avg' ? (p.assists / p.matches).toFixed(1) : p.assists;
                                const kpr = (p.kills / p.rounds_played).toFixed(2);
                                const adr = (p.damage_total / p.rounds_played).toFixed(2);
                                const hs = p.kills > 0 ? Math.round((p.headshot_kills / p.kills) * 100) : 0;
                                
                                return (
                                    <tr key={p.steam_id} onClick={() => onSelectPlayer(String(p.steam_id))} className="hover:bg-zinc-800/50 cursor-pointer transition-colors group">
                                        <td className="p-4 text-zinc-600 font-mono text-xs">{i + 1}</td>
                                        <td className="p-4 font-bold text-white group-hover:text-app-accent transition-colors">{p.name}</td>
                                        <td className="p-4 text-center text-zinc-400">{p.matches}</td>
                                        <td className="p-4 text-center text-zinc-300">{kVal}</td>
                                        <td className="p-4 text-center text-zinc-300">{dVal}</td>
                                        <td className="p-4 text-center text-zinc-500">{aVal}</td>
                                        <td className="p-4 text-center text-zinc-400">{kpr}</td>
                                        <td className="p-4 text-center text-zinc-400">{hs}%</td>
                                        <td className="p-4 text-center text-app-accent font-medium">{adr}</td>
                                        <td className="p-4 text-center relative">
                                            <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden absolute bottom-2 left-0 right-0 mx-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <div className="h-full bg-gradient-to-r from-blue-500 to-app-accent" style={{width: `${(p.hltv_3_0_score / 2.5) * 100}%`}}></div>
                                            </div>
                                            <span className={`font-bold ${p.hltv_3_0_score >= 1.2 ? 'text-app-accent' : p.hltv_3_0_score < 1 ? 'text-zinc-500' : 'text-white'}`}>{p.hltv_3_0_score.toFixed(2)}</span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// --- Main Layout ---
const Main: React.FC = () => {
    const [view, setView] = useState('dashboard');
    const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
    const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

    const handleMatchSelect = (m: Match) => {
        setSelectedMatch(m);
        setView('match_details');
    };

    const handlePlayerSelect = (id: string) => {
        setSelectedPlayerId(id);
        setView('player_profile');
    };

    const navItems = [
        { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
        { id: 'matches', icon: Gamepad2, label: 'Matches' },
        { id: 'maps', icon: MapIcon, label: 'Maps' },
        { id: 'teambuilder', icon: Users, label: 'Team Builder' },
        { id: 'settings', icon: UserCog, label: 'Settings' },
    ];

    const renderContent = () => {
        if (view === 'match_details' && selectedMatch) return <MatchDetails match={selectedMatch} onBack={() => setView('matches')} />;
        if (view === 'player_profile' && selectedPlayerId) return <PlayerProfile playerId={selectedPlayerId} onBack={() => setView('dashboard')} />;
        
        switch (view) {
            case 'dashboard': return <Dashboard onSelectPlayer={handlePlayerSelect} />;
            case 'matches': return <MatchesList onSelect={handleMatchSelect} />;
            case 'maps': return <MapsLeaderboard />;
            case 'teambuilder': return <TeamBuilder />;
            case 'settings': return <Settings />;
            default: return <Dashboard onSelectPlayer={handlePlayerSelect} />;
        }
    };

    return (
        <div className="flex flex-col md:flex-row h-screen bg-app-bg text-app-text overflow-hidden font-sans">
            {/* Sidebar (Desktop) */}
            <div className="hidden md:flex w-64 flex-col border-r border-app-cardHover bg-app-card/30 backdrop-blur-md">
                <div className="p-6 flex items-center gap-3">
                    <button 
                        onClick={() => {
                            setView('dashboard');
                            setSelectedMatch(null);
                            setSelectedPlayerId(null);
                        }}
                        className="w-10 h-10 bg-app-accent hover:bg-white text-white hover:text-app-accent rounded-xl flex items-center justify-center font-black text-sm transition-all shadow-lg shadow-app-accent/20 cursor-pointer"
                    >
                        573
                    </button>
                    <span className="font-bold text-xl tracking-tight">Stats<span className="text-app-accent">Tracker</span></span>
                </div>
                <nav className="flex-1 px-4 space-y-2 mt-4">
                    {navItems.map(item => (
                        <button
                            key={item.id}
                            onClick={() => { setView(item.id); setSelectedMatch(null); setSelectedPlayerId(null); }}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${view === item.id ? 'bg-app-accent text-white shadow-lg shadow-app-accent/20 font-bold' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
                        >
                            <item.icon size={20} />
                            {item.label}
                        </button>
                    ))}
                </nav>
                <div className="p-6 text-xs text-zinc-600 text-center">
                    v2.5.0 • System Online
                </div>
            </div>

            {/* Mobile Header */}
            <div className="md:hidden h-16 border-b border-app-cardHover bg-app-card/90 backdrop-blur-md flex items-center justify-between px-4 z-20">
                 <div className="flex items-center gap-3">
                    <button 
                        onClick={() => {
                            setView('dashboard');
                            setSelectedMatch(null);
                            setSelectedPlayerId(null);
                        }}
                        className="w-8 h-8 bg-app-accent text-white rounded-lg flex items-center justify-center font-black text-xs shadow-lg shadow-app-accent/20"
                    >
                        573
                    </button>
                    <span className="font-bold text-lg">Stats<span className="text-app-accent">Tracker</span></span>
                </div>
            </div>

            {/* Main Content */}
            <main className="flex-1 overflow-hidden relative">
                {renderContent()}
            </main>

            {/* Bottom Nav (Mobile) */}
            <div className="md:hidden h-16 border-t border-app-cardHover bg-app-card/90 backdrop-blur-md flex justify-around items-center px-2 z-20 fixed bottom-0 w-full">
                 {navItems.map(item => (
                    <button
                        key={item.id}
                        onClick={() => { setView(item.id); setSelectedMatch(null); setSelectedPlayerId(null); }}
                        className={`flex flex-col items-center justify-center p-2 rounded-lg transition-all ${view === item.id ? 'text-app-accent' : 'text-zinc-500'}`}
                    >
                        <item.icon size={20} className={view === item.id ? 'fill-current' : ''} />
                        <span className="text-[10px] mt-1 font-medium">{item.label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
};

const App = () => (
    <AuthProvider>
        <NotificationProvider>
            <StatsProvider>
                <Main />
            </StatsProvider>
        </NotificationProvider>
    </AuthProvider>
);

const root = createRoot(document.getElementById('root')!);
root.render(<App />);