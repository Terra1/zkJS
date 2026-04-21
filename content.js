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
            supplies: 200,
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
            diplomacy: {},
            objectives: []
        }
    }
};

// Generate graph data from RomanGeoMap
for (const [id, def] of Object.entries(RomanGeoMap)) {
    GameContent.graphData[id] = {
        name: def.name,
        terrain: Math.random() > 0.7 ? "mountain" : (Math.random() > 0.5 ? "forest" : "plains"),
        neighbors: def.neighbors,
        polygons: def.polygons,
        cx: parseFloat(def.cx),
        cy: parseFloat(def.cy),
        grain_production: (Math.random() > 0.6 ? 0 : Math.floor(100 + Math.random() * 400)),
        grain_requirement: Math.floor(50 + Math.random() * 150)
    };
}
