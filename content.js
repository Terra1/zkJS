const GameContent = {
    // We ingest RomanGeoMap which is loaded from roman_map.js
    graphData: {},
    romanNames: ['Aurelian', 'Valerian', 'Probus', 'Gallienus', 'Claudius', 'Postumus', 'Tetricus', 'Victorinus', 'Macrianus', 'Quietus', 'Aemilian', 'Regalianus', 'Odenathus', 'Magnus', 'Felix', 'Severus', 'Maximinus', 'Gordian', 'Philip', 'Decius', 'Gallus', 'Aemilianus', 'Quietus', 'Marinus'],
    personalities: ['cautious', 'ambitious', 'corrupt', 'loyal', 'aggressive', 'diplomatic', 'pragmatic', 'honorable'],
    barbarianNames: ['Alaric', 'Attila', 'Vercingetorix', 'Mithridates', 'Hannibal', 'Arminius', 'Decebalus', 'Shapur', 'Zenobia', 'Gaiseric', 'Vitigis'],
    merchantNames: ['Castor', 'Pollux', 'Mercurio', 'Porticus', 'Taberna', 'Negotiator'],
    bandits: ['Rufus', 'Scaeva', 'Maximus the Wild', 'Petra', 'Varro'],
    factions: ['emperor', 'player', 'rival', 'barbarian', 'independent', 'merchant', 'brigand'],
    tribes: ['Goths', 'Vandals', 'Alemanni', 'Franks', 'Burgundians', 'Sarmatians', 'Heruli', 'Quadi', 'Carpi', 'Marcomanni'],
    romeNode: 'i',  // Province id for Rome
    initialState: {
        day: 1,
        year: 260,
        flags: {
            in_combat: false,
            game_over: false
        },
        world: {
            nodes: {},
            actors: [],
            emperorId: null,
            romeNode: 'i',
            convoys: [],
            trade_routes: [],
            alliances: [],
            history: []
        },
        player: {
            name: "Commander",
            node: "dalmatia",
            wealth: 1000,
            strength: 4000,
            morale: 100,
            grain: 500,
            subordinates: [],
            superior: null,
            daily_cost: 50,
            loyalty: 100,
            legions: {
                left: { size: 1000, max: 1000, exp: 1, type: "infantry" },
                center: { size: 1000, max: 1000, exp: 1, type: "infantry" },
                right: { size: 1000, max: 1000, exp: 1, type: "infantry" },
                reserve: { size: 500, max: 500, exp: 1, type: "infantry" }
            },
            diplomacy: {}
        }
    }
};

// Historically accurate names for the Augustan regions of Italia (I-XI)
// as they appear in the Notitia Dignitatum / late Roman administrative records
const italianRegionNames = {
    'i':    'Latium et Campania',     // Contains Rome; Region I
    'ii':   'Apulia et Calabria',     // Region II — heel of Italy
    'iii':  'Lucania et Bruttii',     // Region III — toe of Italy
    'iv':   'Samnium',                // Region IV — central Apennines
    'v':    'Picenum Suburbicarium',  // Region V — Adriatic coast south
    'vi':   'Umbria',                 // Region VI — central highlands
    'vii':  'Etruria',               // Region VII — Tuscany
    'viii': 'Aemilia',               // Region VIII — Po valley east
    'ix':   'Liguria',               // Region IX — Ligurian coast
    'x':    'Venetia et Histria',    // Region X — northeast Italy
    'xi':   'Transpadana',           // Region XI — upper Po valley
};

// Generate graph data from RomanGeoMap
for (const [id, def] of Object.entries(RomanGeoMap)) {
    GameContent.graphData[id] = {
        name: italianRegionNames[id] || def.name,
        terrain: Math.random() > 0.7 ? "mountain" : (Math.random() > 0.5 ? "forest" : "plains"),
        neighbors: def.neighbors,
        polygons: def.polygons,
        cx: parseFloat(def.cx),
        cy: parseFloat(def.cy),
        grain_production: (Math.random() > 0.6 ? 0 : Math.floor(100 + Math.random() * 400)),
        grain_requirement: Math.floor(50 + Math.random() * 150)
    };
}

// Ensure Cyprus borders only Cilicia (fix adjacency)
if (GameContent.graphData['cyprus']) {
    GameContent.graphData['cyprus'].neighbors = ['cilicia'];
}
// Ensure bidirectional adjacency: add Cyprus to Cilicia's neighbors if missing
if (GameContent.graphData['cilicia']) {
    const neigh = GameContent.graphData['cilicia'].neighbors || [];
    if (!neigh.includes('cyprus')) {
        neigh.push('cyprus');
        GameContent.graphData['cilicia'].neighbors = neigh;
    }
}
