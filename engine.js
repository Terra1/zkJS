class Engine {
    constructor(content, outputCallback, updateUICallback) {
        this.content = content;
        this.outputCallback = outputCallback;
        this.updateUICallback = updateUICallback;
        this.actorIdCounter = 0;
        this.resetState();
    }

    generateId() {
        return 'act_' + (++this.actorIdCounter);
    }

    resetState() {
        this.state = JSON.parse(JSON.stringify(this.content.initialState));
        this.generateWorld();
    }

    loadState(saveData) {
        this.state = saveData;
        this.look();
        // Small loyalty drift each tick: ambition erodes loyalty slowly
        try {
            this.state.world.actors.forEach(a => {
                if (!a || a.state === 'dead') return;
                const ambition = a.ambition || 0;
                const decay = Math.floor(ambition / 60);
                if (!a.loyalty) a.loyalty = 50;
                a.loyalty = Math.max(0, a.loyalty - decay - (Math.random() < 0.03 ? 1 : 0));
            });
        } catch (e) {
            console.error('Loyalty drift error', e);
        }

        // Allow the emperor and senate to act on vacancies or perform maintenance
        try {
            this.processSenateIfNeeded();
        } catch (e) {
            console.error('Error processing senate:', e);
        }
        try {
            this.emperorActions();
        } catch (e) {
            console.error('Error in emperor actions:', e);
        }

        this.updateUI();
    }

    getSaveData() {
        return this.state;
    }

    // Return actor object by id; supports the special 'player' pseudo-actor
    getActorById(id) {
        if (!id) return null;
        if (id === 'player') {
            // Return a lightweight actor-like view of the player
            const p = this.state.player;
            return {
                id: 'player', name: p.name || 'You', node: p.node, realm: 'player', strength: p.strength, wealth: p.wealth,
                grain: p.grain, loyalty: p.loyalty, martial: p.martial || 3, morale: p.morale
            };
        }
        return this.state.world.actors.find(a => a.id === id) || null;
    }

    generateWorld() {
        this.state.world.nodes = {};
        this.state.world.actors = [];
        this.state.world.romeNode = this.content.romeNode;
        
        // 1. Initialize Nodes with full economy
        for (const [id, def] of Object.entries(this.content.graphData)) {
            let realm = 'independent';
            if (id === 'dalmatia') realm = 'player';
            
            if (Math.random() < 0.08 && realm !== 'player' && id !== 'i') realm = 'rival';

            this.state.world.nodes[id] = {
                id: id,
                name: def.name,
                terrain: def.terrain,
                neighbors: def.neighbors,
                polygons: def.polygons,
                cx: def.cx,
                cy: def.cy,
                realm: realm,
                wealth: 200 + Math.floor(Math.random() * 800),
                unrest: Math.floor(Math.random() * 15),
                grain: def.grain_production * 3,
                grain_production: def.grain_production,
                grain_requirement: def.grain_requirement,
                garrison_id: null,
                garrison_strength: 0
            };
        }
        
        // 2. Spawn Emperor with full logistical model
        const empName = this.content.romanNames[Math.floor(Math.random() * this.content.romanNames.length)];
        const emperor = {
            id: this.generateId(), type: 'emperor', name: `Emperor ${empName}`,
            node: 'i', realm: 'emperor', faction: 'emperor',
            strength: 12000, wealth: 8000, grain: 3000,
            loyalty: 100, ambition: 0, martial: 6,
            personality: 'cautious', state: 'idle', subordinates: [],
            daily_cost: 100, supply_level: 1.0, morale: 100
        };
        this.state.world.actors.push(emperor);
        this.state.world.emperorId = emperor.id;
        this.state.world.nodes[emperor.node].realm = 'emperor';
        this.state.world.nodes[emperor.node].garrison_id = emperor.id;
        this.state.world.nodes[emperor.node].garrison_strength = emperor.strength;

        // 3. Spawn Imperial Bureaucracy (hierarchical)
            const regionalGovs = new Map();
            for (const [id, node] of Object.entries(this.state.world.nodes)) {
                if (node.realm === 'emperor' && id !== emperor.node && Math.random() < 0.25) {
                    const gName = this.content.romanNames[Math.floor(Math.random() * this.content.romanNames.length)];
                    const pers = this.content.personalities[Math.floor(Math.random() * this.content.personalities.length)];
                    const gov = {
                        id: this.generateId(), type: 'governor', name: `${gName}`,
                        node: id, realm: 'emperor', faction: 'emperor',
                        strength: 400 + Math.floor(Math.random() * 1200), wealth: 300 + Math.floor(Math.random() * 400), grain: 300,
                        loyalty: 50 + Math.floor(Math.random() * 50), ambition: Math.floor(Math.random() * 100),
                        martial: 2 + Math.floor(Math.random() * 5), personality: pers, state: 'idle',
                        subordinates: [], superior: emperor.id, orders: 'hold',
                        daily_cost: 20, supply_level: 1.0, morale: 80
                    };
                    this.state.world.actors.push(gov);
                    emperor.subordinates.push(gov.id);
                    node.garrison_id = gov.id;
                    node.garrison_strength = gov.strength;
                }
            }

            // Initialize Senate from some of the imperial governors (if any)
            this.state.world.senate = [];
            const govs = this.state.world.actors.filter(a => a.type === 'governor');
            if (govs.length > 0) {
                // pick up to 6 governors as senators, prefer higher wealth/strength
                govs.sort((a,b) => ((b.wealth||0) + (b.strength||0)/2) - ((a.wealth||0) + (a.strength||0)/2));
                const senateSize = Math.min(6, Math.max(3, Math.floor(govs.length / 3)));
                for (let i = 0; i < senateSize && i < govs.length; i++) {
                    const s = govs[i];
                    s.isSenator = true;
                    s.influence = (s.wealth || 1000) / 1000 + (s.strength || 1000) / 2000;
                    this.state.world.senate.push(s.id);
                }
            }
        
        // 4. Spawn Rival Factions
        const rivalCount = Math.floor(2 + Math.random() * 3);
        const nodeKeys = Object.keys(this.state.world.nodes);
        for (let i = 0; i < rivalCount; i++) {
            const rName = this.content.romanNames[Math.floor(Math.random() * this.content.romanNames.length)];
            let spawnNode = null;
            for (let attempt = 0; attempt < 10; attempt++) {
                const candidate = nodeKeys[Math.floor(Math.random() * nodeKeys.length)];
                if (this.state.world.nodes[candidate].realm === 'independent') {
                    spawnNode = candidate;
                    break;
                }
            }
            if (!spawnNode) continue;
            
            const rival = {
                id: this.generateId(), type: 'rival', name: `${rName}`,
                node: spawnNode, realm: `rival_${rName}`, faction: `rival_${rName}`,
                strength: 2000 + Math.floor(Math.random() * 3000), wealth: 800 + Math.floor(Math.random() * 400), grain: 500,
                loyalty: 0, ambition: 90 + Math.floor(Math.random() * 10), martial: 4 + Math.floor(Math.random() * 4),
                personality: 'aggressive', state: 'marching', subordinates: [],
                orders: 'march_to_rome', target: 'i',
                daily_cost: 50, supply_level: 1.0, morale: 90
            };
            this.state.world.actors.push(rival);
            this.state.world.nodes[spawnNode].realm = rival.realm;
            this.state.world.nodes[spawnNode].garrison_id = rival.id;
            this.state.world.nodes[spawnNode].garrison_strength = rival.strength;
        }
        
        // 5. Spawn independent merchant and brigand factions
        for (let i = 0; i < 2; i++) {
            const mName = this.content.merchantNames[Math.floor(Math.random() * this.content.merchantNames.length)];
            let mNode = null;
            for (let attempt = 0; attempt < 5; attempt++) {
                const candidate = nodeKeys[Math.floor(Math.random() * nodeKeys.length)];
                if (!this.state.world.nodes[candidate].garrison_id) {
                    mNode = candidate;
                    break;
                }
            }
            if (!mNode) continue;
            
            const merchant = {
                id: this.generateId(), type: 'merchant', name: `${mName}`,
                node: mNode, realm: 'independent', faction: 'merchant',
                strength: 0, wealth: 2000 + Math.floor(Math.random() * 1000), grain: 600,
                cargo: 0, cargo_capacity: 300,
                loyalty: 0, ambition: 60, martial: 0,
                personality: 'pragmatic', state: 'trading', subordinates: [],
                orders: 'trade', trade_networks: [],
                daily_cost: 5, supply_level: 1.0, morale: 80
            };
            this.state.world.actors.push(merchant);
        }
    }

    print(text, type = 'normal') {
        this.outputCallback(text, type);
    }

    updateUI() {
        this.updateUICallback(this.state);
    }

    look() {
        if (this.state.flags.in_combat) {
            this.print("--- BATTLEFIELD ---", "combat-text");
            this.print(`Enemy: ${this.combatState.enemy.name} (Strength: ${this.combatState.enemy.strength})`);
            this.print(`Your Wings - L: ${this.combatState.left} | C: ${this.combatState.center} | R: ${this.combatState.right} | Res: ${this.combatState.reserve}`);
            this.print("Commands: order [left|center|right] [attack|defend|flank], order reserve reinforce [wing]");
            this.updateUI();
            return;
        }

        const currentNode = this.state.world.nodes[this.state.player.node];
        
        this.print(`\n=== PROVINCE: ${currentNode.name.toUpperCase()} ===`, 'room');
        this.print(`Terrain: ${currentNode.terrain} | Realm: ${currentNode.realm}`);
        this.print(`Economy: Wealth ${currentNode.wealth} | Unrest ${currentNode.unrest}%`);
        
        const localActors = this.state.world.actors.filter(a => a.node === currentNode.id && a.state !== 'dead');
        if (localActors.length > 0) {
            this.print("Actors present:");
            localActors.forEach(a => {
                this.print(` - ${a.name} (${a.type}) | Strength: ${a.strength} | Realm: ${a.realm}`, 'actor-text');
            });
        }
        
        this.print("Adjacent Provinces (march [name]):");
        currentNode.neighbors.forEach(nId => {
            const n = this.state.world.nodes[nId];
            this.print(` - ${n.name} [${nId}]`);
        });

        this.updateUI();
    }

    // Basic BFS pathfinding to find the next node towards a target
    findNextStepTo(startId, targetId) {
        if (startId === targetId) return startId;
        const queue = [startId];
        const cameFrom = { [startId]: null };
        
        while (queue.length > 0) {
            const current = queue.shift();
            if (current === targetId) break;
            
            const node = this.state.world.nodes[current];
            for (const next of node.neighbors) {
                if (!(next in cameFrom)) {
                    queue.push(next);
                    cameFrom[next] = current;
                }
            }
        }
        
        if (!(targetId in cameFrom)) return startId; // No path found
        
        let curr = targetId;
        while (cameFrom[curr] !== startId) {
            curr = cameFrom[curr];
        }
        return curr; // This is the adjacent node to take
    }

    passTime(days) {
        this.state.day += days;
        const nodes = this.state.world.nodes;
        const actors = this.state.world.actors;
        const emperor = actors.find(a => a.id === this.state.world.emperorId);

        // ===== PHASE 1: GRAIN-BASED MAINTENANCE (identical for all actors + player) =====
        // Troops eat grain. Gold is never consumed for maintenance — only for hiring.
        // Consumption rate: 1 grain per 10 troops per day.
        const grainPerTroopPerDay = (strength) => Math.max(1, Math.ceil(strength / 100));

        // --- Actors ---
        actors.forEach(actor => {
            if (actor.state === 'dead') return;
            const consumed = grainPerTroopPerDay(actor.strength) * days;
            // Draw from home province first (garrisoned supply)
            const actorNode = nodes[actor.node];
            if (actorNode && actorNode.grain > 0) {
                const drawn = Math.min(actorNode.grain, consumed);
                actorNode.grain -= drawn;
                actor.grain += drawn;
            }
            actor.grain -= consumed;
            if (actor.grain <= 0) {
                actor.grain = 0;
                actor.morale = Math.max(0, actor.morale - 5 * days);
                if (actor.morale <= 20) {
                    const lost = Math.floor(actor.strength * 0.05 * days);
                    actor.strength = Math.max(0, actor.strength - lost);
                }
            } else {
                actor.morale = Math.min(100, actor.morale + days);
            }
            if (actor.strength <= 0) actor.state = 'dead';
        });

        // --- Player (same rules) ---
        const playerConsumed = grainPerTroopPerDay(this.state.player.strength) * days;
        this.state.player.grain -= playerConsumed;
        if (this.state.player.grain <= 0) {
            this.state.player.grain = 0;
            this.state.player.morale = Math.max(0, this.state.player.morale - 5 * days);
            this.print(`STARVATION: Your legion lacks grain! Morale: ${this.state.player.morale}%`, "error-text");
            if (this.state.player.morale <= 20) {
                const deserters = Math.floor(this.state.player.strength * 0.05 * days);
                this.state.player.strength = Math.max(0, this.state.player.strength - deserters);
                if (deserters > 0) this.print(`${deserters} men deserted. Strength: ${this.state.player.strength}`, "error-text");
            }
        } else {
            this.state.player.morale = Math.min(100, this.state.player.morale + days);
        }
        if (this.state.player.strength <= 0) {
            this.print("Your legion has been entirely wiped out. GAME OVER.", "error-text");
            this.state.flags.game_over = true;
            this.updateUI();
            return;
        }

        // ===== PHASE 2: GRAIN PRODUCTION & NODE ECONOMY =====
        for (const nodeId in nodes) {
            const node = nodes[nodeId];
            node.wealth += 7 + Math.floor(Math.random() * 13);  // Base income
            node.grain += node.grain_production || 20;
            node.grain_requirement = node.population || 50;
            node.grain -= node.grain_requirement;

            if (node.grain < 0) {
                const shortage = Math.abs(node.grain);
                node.unrest += Math.min(40, shortage / 10);
                node.grain = 0;
            }

            // Unrest natural decay
            if (node.unrest > 0) node.unrest -= 1;

            // High unrest causes economic damage
            if (node.unrest > 50) node.wealth -= 15;
            if (node.wealth < 0) node.wealth = 0;
        }

        // ===== PHASE 3: HIERARCHICAL TAXATION =====
        // Emperor collects taxes from all emperor-realm provinces via governor subordinates
        if (emperor && emperor.state !== 'dead') {
            let emperorIncome = 0;
            emperor.subordinates.forEach(subId => {
                const gov = actors.find(a => a.id === subId);
                if (!gov) return;
                const govNode = nodes[gov.node];

                // Governor collects 10% base but personality modifies
                let taxRate = 0.10;
                if (gov.personality === 'corrupt') taxRate = 0.15;
                else if (gov.personality === 'diplomatic') taxRate = 0.07;
                else if (gov.personality === 'loyal') taxRate = 0.12;

                const collected = Math.floor(govNode.wealth * taxRate);
                // Governor takes a local cut; remainder forwarded to emperor
                const governorCut = Math.floor(collected * 0.5);
                const forwarded = collected - governorCut;

                gov.wealth += governorCut;
                govNode.wealth -= collected;
                govNode.unrest += taxRate * 5;  // Taxation causes unrest

                emperorIncome += forwarded;
            });
            emperor.wealth += emperorIncome;
        }

        // Player collects taxes from subordinates and their provinces
        let playerIncome = 0;
        this.state.player.subordinates.forEach(subId => {
            const sub = actors.find(a => a.id === subId);
            if (!sub || sub.state === 'dead') return;
            const subNode = nodes[sub.node];

            // Subordinate auto-taxes their home province
            let taxRate = 0.08;  // Base subordinate tax rate
            const collected = Math.floor(subNode.wealth * taxRate);
            sub.wealth += collected;
            subNode.wealth -= collected;
            subNode.unrest += taxRate * 3;

            // Subordinate gives cut to player
            const playerCut = Math.floor(collected * 0.3);
            sub.wealth -= playerCut;
            playerIncome += playerCut;
        });
        this.state.player.wealth += playerIncome;

        // ===== TRADE ROUTE INCOME =====
        // Adjacent player-controlled provinces generate passive trade income
        const playerNodes = Object.values(nodes).filter(n => n.realm === 'player');
        let tradeIncome = 0;
        playerNodes.forEach(n => {
            const adjacent = n.neighbors.filter(nId => nodes[nId] && nodes[nId].realm === 'player');
            tradeIncome += adjacent.length * 5; // 5 gold per connected player province
        });
        if (tradeIncome > 0) {
            this.state.player.wealth += tradeIncome;
            if (this.state.day % 10 === 0) {
                this.print(`Trade income: +${tradeIncome} gold from your realm's internal trade.`, "intel-text");
            }
        }

        // Subordinate 'tax' order: collect taxes from their current province
        this.state.player.subordinates.forEach(subId => {
            const sub = actors.find(a => a.id === subId);
            if (!sub || sub.state === 'dead' || sub.orders !== 'tax') return;
            const subNode = nodes[sub.node];
            if (!subNode || subNode.realm !== 'player') return;
            const taxCollected = Math.floor(subNode.wealth * 0.1);
            sub.wealth += Math.floor(taxCollected * 0.7);
            this.state.player.wealth += Math.floor(taxCollected * 0.3);
            subNode.wealth -= taxCollected;
            subNode.unrest += 8;
        });

        // ===== PHASE 4: SUBORDINATE AI & LOYALTY =====
        this.state.player.subordinates.forEach(subId => {
            const sub = actors.find(a => a.id === subId);
            if (!sub || sub.state === 'dead') return;
            
            const node = nodes[sub.node];

            // Movement: Execute player orders
            if (sub.target_province && sub.node !== sub.target_province) {
                const path = this.findNextStepTo(sub.node, sub.target_province);
                if (path) sub.node = path;
            }

            // Conquer orders
            if (sub.orders === 'conquer' && node.realm !== 'player') {
                const defender = actors.find(a => a.node === node.id && a.state !== 'dead' && a.realm !== 'player');
                if (defender) {
                    // Simulate a battle between subordinate and defender
                    const result = this.simulateBattle(sub, defender);
                    if (result === 'attacker') {
                        node.realm = 'player';
                        node.garrison_id = sub.id;
                        node.garrison_strength = sub.strength;
                        this.print(`${sub.name} has conquered ${node.name} for your realm after battle!`, 'intel-text');
                    }
                    // clear orders regardless of result
                    sub.orders = null;
                } else {
                    node.realm = 'player';
                    node.garrison_id = sub.id;
                    node.garrison_strength = sub.strength;
                    this.print(`${sub.name} has conquered ${node.name} for your realm!`, 'intel-text');
                    sub.orders = null;
                }
            }

            // Recruitment: requires wealth and decent morale
            if (sub.wealth > 200 && sub.morale > 50 && Math.random() < 0.15) {
                const recruits = 50 + Math.floor(Math.random() * 150);
                sub.strength += recruits;
                sub.wealth -= 200;
            }

            // Loyalty degradation if not paid (wealth declining)
            if (sub.wealth < 100) {
                sub.loyalty -= 2;
            } else {
                sub.loyalty -= 1;  // Still small decay
            }

            // Morale linked to supply
            if (sub.grain > (sub.strength / 100)) {
                sub.morale += 1;  // Well-fed
            } else if (sub.grain < (sub.strength / 200)) {
                sub.morale -= 2;  // Starving
            }

            // REBELLION: Check conditions
            if (sub.loyalty < 20 && sub.morale < 40 && Math.random() < 0.4) {
                sub.type = 'rival';
                sub.realm = `rival_${sub.name}`;
                sub.state = 'marching';
                node.realm = sub.realm;
                const idx = this.state.player.subordinates.indexOf(sub.id);
                if (idx > -1) this.state.player.subordinates.splice(idx, 1);
                this.print(`${sub.name} has BETRAYED YOU and turned against your realm!`, 'error-text');
            }
        });

        // ===== PHASE 5: GOVERNOR & ACTOR AI =====
        actors.forEach(actor => {
            if (actor.state === 'dead') return;

            // Lightweight autonomy decision: give idle actors simple goals
            // so they act without being micromanaged.
            if (!actor.orders) {
                if (actor.type === 'governor') actor.orders = 'admin';
                else if (actor.type === 'rival') actor.orders = Math.random() < 0.6 ? 'consolidate' : 'march_to_rome';
                else if (actor.type === 'barbarian') actor.orders = 'raid';
                else if (actor.type === 'merchant') actor.orders = 'trade';
                else if (actor.type === 'brigand') actor.orders = 'raid';
            }

            // Quick threat-scan for non-merchant actors: respond to nearby barbarians
            try {
                if (['subordinate','rival','governor'].includes(actor.type)) {
                    const node = this.state.world.nodes[actor.node];
                    if (node && node.neighbors && node.neighbors.length > 0) {
                        const barb = node.neighbors.map(nid => actors.find(a => a.node === nid && a.type === 'barbarian' && a.state !== 'dead')).find(x => x);
                        if (barb) {
                            // If strong enough, engage; else try raising troops or hold
                            if (actor.strength > (barb.strength || 0) * 0.6) {
                                this.print(`${actor.name} moves to confront barbarian ${barb.name}.`, 'intel-text');
                                this.simulateBattle(actor, barb);
                            } else {
                                if (actor.wealth > 100 && Math.random() < 0.5) {
                                    const spend = Math.min(actor.wealth - 50, 150);
                                    const recruits = Math.floor(spend / 10);
                                    actor.strength += recruits;
                                    actor.wealth -= spend;
                                    this.print(`${actor.name} hastily raises ${recruits} men against barbarians.`, 'intel-text');
                                } else {
                                    actor.orders = 'hold';
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('threat-scan error', e);
            }

            // Subordinate-specific autonomy: scheming, competent, and helpful
            if (actor.type === 'subordinate') {
                try {
                    const isPlayerSub = actor.superior === 'player' || actor.realm === 'player';
                    const playerNode = this.state.player.node;
                    const myNode = this.state.world.nodes[actor.node];

                    // If allied to player and player is in combat nearby, rush to assist
                    if (isPlayerSub && this.state.flags.in_combat && this.combatState && this.combatState.enemy) {
                        const nearby = (actor.node === playerNode) || (myNode && myNode.neighbors && myNode.neighbors.includes(playerNode));
                        if (nearby) {
                            actor.node = playerNode;
                            this.print(`${actor.name} rushes to assist you at ${this.state.world.nodes[playerNode].name}!`, 'intel-text');
                            // Small pitched fight to weaken enemy before player's next move
                            try {
                                this.simulateBattle(actor, this.combatState.enemy);
                            } catch (e) { console.error('assist-battle error', e); }
                        }
                    }

                    // Subordinate self-recruit when wealthy
                    if (actor.wealth > 250 && Math.random() < 0.18) {
                        const spend = Math.min(actor.wealth - 50, 300);
                        const recruits = Math.floor(spend / 10);
                        if (recruits > 0) {
                            actor.strength += recruits;
                            actor.wealth -= spend;
                            this.print(`${actor.name} recruits ${recruits} men autonomously.`, 'intel-text');
                        }
                    }

                    // Patrol / expand for the player: take weak neighboring independents
                    if (isPlayerSub && myNode && myNode.neighbors && Math.random() < 0.12) {
                        const targets = myNode.neighbors.filter(nid => {
                            const n = this.state.world.nodes[nid];
                            if (!n) return false;
                            if (n.realm === 'player' || n.realm === actor.realm) return false;
                            const g = n.garrison_id ? this.getActorById(n.garrison_id) : null;
                            return !g || g.strength < actor.strength * 0.7;
                        });
                        if (targets.length > 0) {
                            const pick = targets[Math.floor(Math.random() * targets.length)];
                            const tgtNode = this.state.world.nodes[pick];
                            // If garrison present, fight
                            const gId = tgtNode.garrison_id;
                            const garrison = gId ? this.getActorById(gId) : null;
                            if (garrison) {
                                const res = this.simulateBattle(actor, garrison);
                                if (res === 'attacker') {
                                    tgtNode.realm = 'player';
                                    tgtNode.garrison_id = actor.id;
                                    tgtNode.garrison_strength = actor.strength;
                                    this.print(`${actor.name} has seized ${tgtNode.name} for your realm.`, 'intel-text');
                                }
                            } else {
                                tgtNode.realm = 'player';
                                tgtNode.garrison_id = actor.id;
                                tgtNode.garrison_strength = actor.strength;
                                this.print(`${actor.name} occupies ${tgtNode.name} for your realm.`, 'intel-text');
                            }
                        }
                    }

                    // Small scheming: occasionally try to curry favor or bribe nearby senators/governors
                    if (actor.loyalty > 40 && Math.random() < 0.05) {
                        // deposit a small gift to player-coffers (simulates tax remittance)
                        if (isPlayerSub && actor.wealth > 50) {
                            const gift = Math.min(actor.wealth, 30 + Math.floor(Math.random() * 70));
                            actor.wealth -= gift;
                            this.state.player.wealth += Math.floor(gift * 0.6);
                            actor.loyalty = Math.min(100, actor.loyalty + Math.floor(gift/25));
                            this.print(`${actor.name} sends a discreet gift to you (+${Math.floor(gift/25)} loyalty).`, 'intel-text');
                        }
                    }

                    // Ambition-driven plotting: slight chance to seek independent glory if loyalty low
                    if (actor.loyalty < 30 && actor.ambition > 50 && Math.random() < 0.08) {
                        actor.type = 'rival';
                        actor.realm = `rival_${actor.name}`;
                        actor.state = 'marching';
                        this.print(`${actor.name} has quietly plotted to make a name for themselves...`, 'error-text');
                    }
                } catch (e) {
                    console.error('subordinate autonomy error', e);
                }
            }

            // React to simple orders immediately (movement or local actions)
            try {
                const curNode = this.state.world.nodes[actor.node];
                if (actor.type === 'governor' && actor.orders === 'admin') {
                    // Focus on local prosperity and unrest suppression
                    if (curNode && curNode.unrest > 25) {
                        curNode.unrest = Math.max(0, curNode.unrest - 4);
                        actor.morale = Math.min(100, (actor.morale || 50) + 2);
                    } else if (actor.wealth > 200 && Math.random() < 0.2) {
                        actor.strength += 30 + Math.floor(Math.random() * 70);
                        actor.wealth -= 100;
                    }
                }

                if (actor.type === 'rival' && actor.orders === 'consolidate' && actor.state !== 'marching') {
                    // Try to grab adjacent independent provinces before marching to Rome
                    if (curNode && curNode.neighbors && curNode.neighbors.length > 0) {
                        const targets = curNode.neighbors.filter(n => this.state.world.nodes[n] && this.state.world.nodes[n].realm === 'independent');
                        if (targets.length > 0) {
                            const pick = targets[Math.floor(Math.random() * targets.length)];
                            actor.node = pick;
                            const nodeObj = this.state.world.nodes[pick];
                            // If there is a garrison, simulate battle; otherwise claim
                            const gId = nodeObj.garrison_id;
                            const garrison = gId ? this.getActorById(gId) : null;
                            if (garrison) {
                                const res = this.simulateBattle(actor, garrison);
                                if (res === 'attacker') {
                                    nodeObj.realm = actor.realm;
                                    nodeObj.garrison_id = actor.id;
                                    nodeObj.garrison_strength = actor.strength;
                                }
                            } else {
                                nodeObj.realm = actor.realm;
                                nodeObj.garrison_id = actor.id;
                                nodeObj.garrison_strength = actor.strength;
                            }
                        } else {
                            // No easy targets nearby, start marching
                            actor.orders = 'march_to_rome';
                            actor.state = 'marching';
                        }
                    }
                }

                if (actor.type === 'merchant' && actor.orders === 'trade') {
                    // Merchants move grain between provinces and earn profit.
                    if (curNode) {
                        const surplus = Math.max(0, (curNode.grain || 0) - (curNode.grain_requirement || 50));
                        if (surplus > 50 && actor.cargo < actor.cargo_capacity) {
                            const take = Math.min(actor.cargo_capacity - actor.cargo, Math.floor(surplus / 2));
                            actor.cargo += take;
                            curNode.grain = Math.max(0, (curNode.grain || 0) - take);
                            actor.wealth += Math.floor(take * 0.2); // small fee
                        }

                        // Move toward a neighbor with deficit
                        const candidates = curNode.neighbors.filter(nId => {
                            const n = this.state.world.nodes[nId];
                            return n && ((n.grain || 0) < (n.grain_requirement || 50));
                        });
                        if (candidates.length > 0 && Math.random() < 0.7) {
                            actor.node = candidates[Math.floor(Math.random() * candidates.length)];
                        } else if (curNode.neighbors.length > 0 && Math.random() < 0.4) {
                            actor.node = curNode.neighbors[Math.floor(Math.random() * curNode.neighbors.length)];
                        }

                        // Unload if destination needs grain
                        const newNode = this.state.world.nodes[actor.node];
                        if (actor.cargo > 0 && newNode && ((newNode.grain || 0) < (newNode.grain_requirement || 50))) {
                            const unload = Math.min(actor.cargo, Math.max(10, (newNode.grain_requirement || 50) - (newNode.grain || 0)));
                            actor.cargo -= unload;
                            newNode.grain = (newNode.grain || 0) + unload;
                            actor.wealth += Math.floor(unload * 0.5); // merchant profit on delivery
                        }
                    }
                }

                if ((actor.type === 'barbarian' || actor.type === 'brigand') && actor.orders === 'raid') {
                    if (curNode && curNode.neighbors && curNode.neighbors.length > 0) {
                        const targets = curNode.neighbors.filter(n => this.state.world.nodes[n] && this.state.world.nodes[n].realm !== actor.realm);
                        if (targets.length > 0) {
                            const tgt = targets[Math.floor(Math.random() * targets.length)];
                            actor.node = tgt;
                            const tgtNode = this.state.world.nodes[tgt];
                            const loot = Math.floor(tgtNode.wealth * 0.15);
                            actor.wealth += loot;
                            tgtNode.wealth = Math.max(0, tgtNode.wealth - loot);
                            const grainLoot = Math.floor((tgtNode.grain || 0) * 0.3);
                            actor.grain = (actor.grain || 0) + grainLoot;
                            tgtNode.grain = Math.max(0, (tgtNode.grain || 0) - grainLoot);
                            tgtNode.unrest += 8;
                        } else if (curNode.neighbors.length > 0) {
                            actor.node = curNode.neighbors[Math.floor(Math.random() * curNode.neighbors.length)];
                        }
                    }
                }
            } catch (err) {
                // Defensive: if something goes wrong here, don't break the turn loop
                console.error('actor autonomy error', err);
            }

            // Governor behaviors
            if (actor.type === 'governor') {
                const node = nodes[actor.node];
                
                // Personality-driven economic behavior
                if (actor.personality === 'corrupt') {
                    if (node.wealth > 100) {
                        const stolen = Math.floor(node.wealth * 0.15);
                        node.wealth -= stolen;
                        actor.wealth += stolen;
                        node.unrest += 8;
                    }
                } else if (actor.personality === 'loyal') {
                    node.wealth += 30;
                    if (node.unrest > 0) node.unrest -= 3;
                } else if (actor.personality === 'diplomatic') {
                    if (node.unrest > 0) node.unrest -= 5;
                    node.wealth += 15;
                }

                // Ambitious governors may rebel
                if (actor.personality === 'ambitious' && actor.strength > 3000 && actor.loyalty < 50 && Math.random() < 0.1) {
                    actor.type = 'rival';
                    actor.realm = `rival_${actor.name}`;
                    node.realm = actor.realm;
                    actor.state = 'marching';
                    this.print(`INTEL: Governor ${actor.name} has rebelled and claimed ${node.name}!`, 'intel-text');
                }

                // React to nearby barbarian threats: attempt local defense or raise troops
                try {
                    const barbNearby = node.neighbors.map(nid => actors.find(a => a.node === nid && a.type === 'barbarian' && a.state !== 'dead')).find(x => x);
                    if (barbNearby) {
                        // If stronger, engage; otherwise, try to raise troops or hold
                        if (actor.strength > (barbNearby.strength || 0) * 0.6) {
                            this.print(`${actor.name} confronts barbarian ${barbNearby.name} near ${node.name}.`, 'intel-text');
                            const res = this.simulateBattle(actor, barbNearby);
                            if (res === 'attacker') {
                                // Secure the neighbor province
                                const bnode = this.state.world.nodes[barbNearby.node];
                                if (bnode) {
                                    bnode.realm = actor.realm;
                                    bnode.garrison_id = actor.id;
                                    bnode.garrison_strength = actor.strength;
                                }
                            } else {
                                actor.morale = Math.max(0, (actor.morale || 50) - 15);
                            }
                        } else {
                            // Try to muster modest reinforcements if possible
                            if (actor.wealth > 150 && Math.random() < 0.6) {
                                const spend = Math.min(actor.wealth - 50, 200);
                                const recruits = Math.floor(spend / 10);
                                actor.strength += recruits;
                                actor.wealth -= spend;
                                this.print(`${actor.name} raises ${recruits} men to face barbarians.`, 'intel-text');
                            } else {
                                actor.orders = 'hold';
                                actor.morale = Math.max(0, (actor.morale || 50) - 5);
                            }
                        }
                    }
                } catch (e) {
                    console.error('barbarian reaction error', e);
                }

                // Governors slowly recruit if wealthy — occasionally create a subordinate commander
                if (actor.wealth > 150 && Math.random() < 0.25) {
                    if (actor.wealth > 400 && Math.random() < 0.25) {
                        // Create a subordinate officer under this governor
                        const subName = this.content.romanNames[Math.floor(Math.random() * this.content.romanNames.length)];
                        const newSub = {
                            id: this.generateId(), type: 'subordinate', name: `Legate ${subName}`,
                            node: actor.node, realm: actor.realm, faction: actor.faction || actor.realm,
                            strength: 200 + Math.floor(Math.random() * 300), wealth: 50,
                            loyalty: 60 + Math.floor(Math.random() * 30), ambition: 30, martial: 2 + Math.floor(Math.random()*3),
                            personality: 'pragmatic', state: 'idle', subordinates: [], superior: actor.id,
                            daily_cost: 10, supply_level: 1.0, morale: 70
                        };
                        this.state.world.actors.push(newSub);
                        actor.subordinates = actor.subordinates || [];
                        actor.subordinates.push(newSub.id);
                        actor.wealth -= 300;
                    } else {
                        actor.strength += 50 + Math.floor(Math.random() * 100);
                        actor.wealth -= 100;
                    }
                }
            }

            // Rival AI: Phase-based strategy — consolidate a local realm first, march on Rome only when ready
            if (actor.type === 'rival' && actor.state === 'marching') {
                if (!actor.phase) actor.phase = 'consolidate';

                // Recruitment (gold → troops), same rate as player
                if (actor.wealth > 200 && actor.morale > 50 && Math.random() < 0.3) {
                    const spend = Math.min(actor.wealth - 100, 500);
                    const recruits = Math.floor(spend / 10); // 10 gold per troop
                    actor.strength += recruits;
                    actor.wealth -= spend;
                }

                // Rivals may also raise subordinate commanders to garrison newly taken lands
                if (actor.wealth > 600 && Math.random() < 0.12) {
                    const rName = this.content.romanNames[Math.floor(Math.random() * this.content.romanNames.length)];
                    const sub = {
                        id: this.generateId(), type: 'subordinate', name: `Champion ${rName}`,
                        node: actor.node, realm: actor.realm, faction: actor.faction || actor.realm,
                        strength: 300 + Math.floor(Math.random() * 400), wealth: 80,
                        loyalty: 50, ambition: 40, martial: 3 + Math.floor(Math.random()*3),
                        personality: 'aggressive', state: 'idle', subordinates: [], superior: actor.id,
                        daily_cost: 15, supply_level: 1.0, morale: 65
                    };
                    this.state.world.actors.push(sub);
                    actor.subordinates = actor.subordinates || [];
                    actor.subordinates.push(sub.id);
                    actor.wealth -= 450;
                }

                const emperorStr = emperor && emperor.state !== 'dead' ? emperor.strength : 0;

                if (actor.phase === 'consolidate') {
                    // Expand locally — prefer unowned or weak adjacent provinces
                    const currNode = nodes[actor.node];
                    const localTargets = currNode.neighbors.filter(nId => {
                        const n = nodes[nId];
                        if (!n) return false;
                        if (n.realm === actor.realm) return false;
                        if (n.realm === 'player') return false;
                        const g = n.garrison_id ? this.getActorById(n.garrison_id) : null;
                        return !g || g.strength < actor.strength * 0.8;
                    });
                    if (localTargets.length > 0 && Math.random() < 0.6) {
                        const pick = localTargets[Math.floor(Math.random() * localTargets.length)];
                        actor.node = pick;
                        nodes[pick].realm = actor.realm;
                        nodes[pick].garrison_id = actor.id;
                        nodes[pick].garrison_strength = actor.strength;
                    }
                    // Graduate to march phase: own 3+ provinces AND strong enough to challenge Rome
                    const ownedCount = Object.values(nodes).filter(n => n.realm === actor.realm).length;
                    if (ownedCount >= 3 && actor.strength > emperorStr * 0.7 && actor.grain > actor.strength / 50) {
                        actor.phase = 'march';
                        this.print(`INTEL: ${actor.name} has consolidated power and is marching on Rome!`, 'intel-text');
                    }

                } else { // actor.phase === 'march'
                    // Only advance if well-supplied
                    if (actor.grain > actor.strength / 100 && Math.random() < 0.5) {
                        if (actor.node !== this.state.world.romeNode) {
                            const nextStep = this.findNextStepTo(actor.node, this.state.world.romeNode);
                            if (nextStep) {
                                actor.node = nextStep;
                                const n = nodes[nextStep];
                                    const g = n.garrison_id ? this.getActorById(n.garrison_id) : null;
                                    if (n.realm !== actor.realm && (!g || g.strength < actor.strength * 0.8)) {
                                    n.realm = actor.realm;
                                    n.garrison_id = actor.id;
                                    n.garrison_strength = actor.strength;
                                }
                            }
                        }
                    } else if (actor.grain <= actor.strength / 100) {
                        // Pillage current province to resupply
                        const n = nodes[actor.node];
                        if (n.grain > 0) {
                            const take = Math.min(n.grain, Math.ceil(actor.strength / 50));
                            actor.grain += take;
                            n.grain -= take;
                        }
                    }

                    // Combat at Rome
                    if (actor.node === this.state.world.romeNode && emperor && emperor.state !== 'dead') {
                        if (actor.strength > emperor.strength) {
                            this.print(`CRITICAL: ${actor.name} has DEFEATED the Emperor and taken Rome!`, "intel-text");
                            emperor.state = 'dead';
                            actor.type = 'emperor';
                            actor.realm = 'emperor';
                            this.state.world.emperorId = actor.id;
                            actor.state = 'idle';
                        } else {
                            this.print(`INTEL: ${actor.name} assaulted Rome but was repelled.`, "intel-text");
                            actor.strength = Math.floor(actor.strength * 0.5);
                            actor.phase = 'consolidate'; // Fall back and regroup
                            emperor.strength -= Math.floor(actor.strength * 0.3);
                        }
                    }
                }
            }

            // Barbarian AI: raid and pillage — carve out a border realm, do NOT beeline Rome
            if (actor.type === 'barbarian' && actor.state === 'marching') {
                // Grain-based starvation (same as player)
                // (grain already handled in Phase 1 above; this just checks morale outcome)

                // Grow horde when well-fed (gold → recruits) — slowed and capped
                if (actor.grain > actor.strength / 80 && actor.wealth > 100 && Math.random() < 0.2) {
                    const spend = Math.min(actor.wealth - 50, 300);
                    actor.strength += Math.floor(spend / 20); // less efficient than before
                    actor.wealth -= spend;
                    if (actor.strength > 5000) actor.strength = 5000; // hard cap
                }

                // Movement: prefer non-horde realms
                const currNode = nodes[actor.node];
                const adjacentTargets = currNode.neighbors.filter(n => {
                    const target = nodes[n];
                    return target.realm !== actor.realm && !target.realm.startsWith('horde');
                });

                if (adjacentTargets.length > 0) {
                    actor.node = adjacentTargets[Math.floor(Math.random() * adjacentTargets.length)];
                } else if (currNode.neighbors.length > 0) {
                    actor.node = currNode.neighbors[Math.floor(Math.random() * currNode.neighbors.length)];
                }

                const node = nodes[actor.node];
                
                // Pillar territory and capture grain — if a garrison/owner exists, fight them
                if (node.realm !== actor.realm && !node.realm.startsWith('horde')) {
                    const gId = node.garrison_id;
                    const garrison = gId ? this.getActorById(gId) : null;
                    if (garrison) {
                        const res = this.simulateBattle(actor, garrison);
                        if (res === 'attacker') {
                            const plunder = Math.floor(node.wealth * 0.2);
                            actor.wealth += plunder;
                            node.wealth = Math.max(0, node.wealth - plunder);
                            const grainCapture = Math.floor(node.grain * 0.5);
                            actor.grain += grainCapture;
                            node.grain = Math.max(0, node.grain - grainCapture);
                            node.realm = actor.realm;
                            node.unrest = 0;
                            node.garrison_id = actor.id;
                            node.garrison_strength = actor.strength;
                        }
                    } else {
                        const plunder = Math.floor(node.wealth * 0.2);
                        actor.wealth += plunder;
                        node.wealth = Math.max(0, node.wealth - plunder);
                        const grainCapture = Math.floor(node.grain * 0.5);
                        actor.grain += grainCapture;
                        node.grain = Math.max(0, node.grain - grainCapture);
                        node.realm = actor.realm;
                        node.unrest = 0;
                        node.garrison_id = actor.id;
                        node.garrison_strength = actor.strength;
                    }
                }

                // Combat at Rome
                if (actor.node === this.state.world.romeNode && emperor && emperor.state !== 'dead') {
                    if (actor.strength > emperor.strength) {
                        this.print(`CATASTROPHE: Barbarian horde ${actor.name} has SACKED ROME!`, "error-text");
                        emperor.state = 'dead';
                        actor.type = 'emperor';
                        actor.realm = 'emperor';
                        this.state.world.emperorId = actor.id;
                        actor.state = 'idle';
                    } else {
                        this.print(`INTEL: Barbarian horde was repelled from Rome.`, "intel-text");
                        actor.state = 'dead';
                        emperor.strength -= Math.floor(actor.strength * 0.5);
                    }
                }
            }

            // Merchant AI: Trade & avoid combat
            if (actor.type === 'merchant') {
                // Merchants generate wealth through trade
                actor.wealth += 30 + Math.floor(Math.random() * 50);
                
                // Move to avoid combat
                const node = nodes[actor.node];
                const hostileNeighbors = node.neighbors.filter(n => {
                    const neighbor = nodes[n];
                    const threat = actors.find(a => a.node === n && a.strength > actor.strength * 0.8);
                    return threat !== undefined;
                });

                if (hostileNeighbors.length > 0) {
                    // Move away from threat
                    const safeNeighbors = node.neighbors.filter(n => !hostileNeighbors.includes(n));
                    if (safeNeighbors.length > 0) {
                        actor.node = safeNeighbors[Math.floor(Math.random() * safeNeighbors.length)];
                    }
                }

                // Possibly recruit bodyguards if wealthy
                if (actor.wealth > 300 && actor.strength < 1000) {
                    actor.strength += 100;
                    actor.wealth -= 150;
                }
            }

            // Brigand AI: Pillage and raid
            if (actor.type === 'brigand') {
                const node = nodes[actor.node];
                
                // Raiders loot provinces
                if (node.wealth > 50 && node.realm !== actor.realm) {
                    const raid = Math.floor(node.wealth * 0.25);
                    actor.wealth += raid;
                    node.wealth -= raid;
                    node.unrest += 5;
                }

                // Brigands rarely recruit, more likely to die
                if (actor.strength < 500 && Math.random() < 0.3) {
                    actor.state = 'dead';
                }

                // Random movement
                if (node.neighbors.length > 0) {
                    actor.node = node.neighbors[Math.floor(Math.random() * node.neighbors.length)];
                }
            }
        });

        // ===== PHASE 6: UNREST-BASED REBELLION (ONLY when grain fails) =====
        for (const nodeId in nodes) {
            const node = nodes[nodeId];
            if (node.unrest > 85 && node.realm !== 'independent' && node.realm !== 'player' && Math.random() < 0.15) {
                const rName = this.content.romanNames[Math.floor(Math.random() * this.content.romanNames.length)];
                const rebel = {
                    id: this.generateId(), type: 'rival', name: `Rebel ${rName}`,
                    node: node.id, realm: `rebel_${rName}`,
                    strength: 1200 + Math.floor(Math.random() * 2400), wealth: 150,
                    grain: 100, supply_level: 0.8, morale: 70,
                    daily_cost: 10, loyalty: 50, ambition: 100, martial: 3 + Math.floor(Math.random() * 4),
                    personality: this.content.personalities[Math.floor(Math.random() * this.content.personalities.length)], state: 'marching', subordinates: [], superior: null,
                    garrison_id: null
                };
                actors.push(rebel);
                node.realm = rebel.realm;
                node.unrest = 0;
                this.print(`REBELLION: ${rName} has raised a rebel army in ${node.name}!`, 'error-text');
            }
        }

        // ===== PHASE 7: REALM COLLAPSE (only when garrison destroyed) =====
        actors.forEach(actor => {
            if (actor.state === 'dead') {
                // Clear any garrisons owned by this dead actor
                for (const nodeId in nodes) {
                    const node = nodes[nodeId];
                    if (node.garrison_id === actor.id) {
                        node.garrison_id = null;
                        node.garrison_strength = 0;
                        // Province reverts to independent ONLY if its realm matched the dead actor
                        if (node.realm === actor.realm) {
                            node.realm = 'independent';
                            node.unrest = Math.floor(Math.random() * 30);
                        }
                    }
                }
            }
        });

        // ===== PHASE 8: BARBARIAN SPAWN =====
        // Spawn barbarians less frequently and with reduced initial strength
        if (Math.random() < 0.02) {
            const bIdx = Math.floor(Math.random() * this.content.barbarianNames.length);
            const bName = this.content.barbarianNames[bIdx];
            // Use actual province IDs from roman_map.js
            const edgeNodes = ['britannia', 'belgica', 'germania_superior', 'raetia', 'dacia', 'moesia_inferior', 'bithynia_et_pontus', 'armenia_mesopotamia', 'arabia', 'mauretania_tingitana'].filter(n => nodes[n]);
            if (edgeNodes.length > 0) {
                const spawnNode = edgeNodes[Math.floor(Math.random() * edgeNodes.length)];
                actors.push({
                    id: this.generateId(), type: 'barbarian', name: `${bName}`,
                    node: spawnNode, realm: `horde_${bName}`,
                    // much smaller initial hordes
                    strength: 800 + Math.floor(Math.random() * 2600),
                    wealth: 200, grain: 400, supply_level: 1.0,
                    daily_cost: 20, morale: 80,
                    loyalty: 0, ambition: 100, martial: 6,
                    personality: 'aggressive', state: 'marching', subordinates: [], superior: null,
                    garrison_id: null
                });
                this.print(`ALERT: Barbarian horde ${bName} has crossed the frontier!`, 'error-text');
            }
        }

        this.updateUI();
    }

    startCombat(enemyActor) {
        this.state.flags.in_combat = true;
        const baseWing = Math.floor(this.state.player.strength / 4);
        
        this.combatState = {
            enemy: enemyActor,
            left: baseWing,
            center: baseWing + (this.state.player.strength % 4),
            right: baseWing,
            reserve: baseWing,
            enemyCenter: enemyActor.strength,
            turn: 1
        };
        this.look();
    }

    processCombat(args) {
        if (args.length < 2) {
            this.print("Format: order [wing] [tactic]");
            return;
        }

        const wing = args[1]; // left, center, right, reserve
        const tactic = args[2]; // attack, defend, flank, reinforce

        if (!['left', 'center', 'right', 'reserve'].includes(wing)) {
            this.print("Invalid wing. Use: left, center, right, reserve");
            return;
        }

        let pDamage = 0;
        let eDamage = 0;
        const eBase = Math.floor(this.combatState.enemyCenter * 0.1);
        const wingStrength = this.combatState[wing];
        const pBase = Math.floor(wingStrength * 0.1 * (this.state.player.morale / 100));

        if (wing === 'reserve') {
            if (tactic === 'reinforce' && args[3]) {
                const target = args[3];
                if (['left', 'center', 'right'].includes(target)) {
                    this.combatState[target] += this.combatState.reserve;
                    this.combatState.reserve = 0;
                    this.print(`Reserve reinforces the ${target}!`);
                    return; // Turn doesn't end just for reinforcing
                }
            }
            this.print("The reserve can only reinforce another wing: order reserve reinforce [left|center|right]", "error-text");
            return;
        }

        switch(tactic) {
            case 'attack':
                pDamage = pBase * 1.2;
                eDamage = eBase * 0.3;
                this.print(`The ${wing} wing launches a frontal assault!`);
                break;
            case 'defend':
                pDamage = pBase * 0.5;
                eDamage = eBase * 0.1;
                this.print(`The ${wing} wing forms a shield wall.`);
                break;
            case 'flank':
                if (wing === 'center') {
                    this.print("The center cannot flank!", "error-text");
                    return;
                }
                if (Math.random() > 0.4) {
                    pDamage = pBase * 2.5;
                    this.print(`The ${wing} wing successfully flanks the enemy!`, "room");
                } else {
                    pDamage = pBase * 0.2;
                    eDamage = eBase * 0.6;
                    this.print(`The ${wing} wing flanking maneuver was crushed!`, "error-text");
                }
                break;
            case 'flee':
                if (Math.random() > 0.5) {
                    this.print("You ordered a full retreat. The legion escapes.");
                    this.state.flags.in_combat = false;
                    this.state.player.morale -= 30;
                    this.updatePlayerStrengthFromWings();
                    this.look();
                    return;
                } else {
                    this.print("Retreat failed! Enemy pursues!", "error-text");
                    eDamage = eBase * 1.5;
                }
                break;
            default:
                this.print("Invalid tactic. Use: attack, defend, flank, flee", "error-text");
                return;
        }

        pDamage = Math.floor(pDamage * (0.8 + Math.random() * 0.4));
        eDamage = Math.floor(eDamage * (0.8 + Math.random() * 0.4));

        this.combatState.enemyCenter -= pDamage;
        this.combatState[wing] -= eDamage;

        // Update player's total strength to reflect wing casualties immediately
        this.updatePlayerStrengthFromWings();

        this.print(`Your ${wing} inflicted ${pDamage} casualties and took ${eDamage}.`);

        // Check for total player destruction mid-battle
        if (this.state.player.strength <= 0) {
            this.print("Your entire legion has been annihilated in battle. GAME OVER.", "error-text");
            this.state.flags.game_over = true;
            this.state.player.strength = 0;
            this.updateUI();
            return;
        }

        if (this.combatState.enemyCenter <= 0) {
            this.print(`VICTORY! You routed ${this.combatState.enemy.name}!`, "room");
            this.state.flags.in_combat = false;
            this.combatState.enemy.state = 'dead';
            this.state.player.morale += 20;
            if (this.state.player.morale > 100) this.state.player.morale = 100;
            this.updatePlayerStrengthFromWings();
            
            if (this.combatState.conquering) {
                const node = this.state.world.nodes[this.state.player.node];
                node.realm = 'player';
                node.garrison_id = 'player';
                node.garrison_strength = this.state.player.strength;
                this.print(`You have conquered ${node.name}! It is now part of your realm.`, "room");
            }
            
            this.passTime(1);
            if (!this.state.flags.game_over) this.look();
            return;
        }

        if (this.combatState.left <= 0 && this.combatState.center <= 0 && this.combatState.right <= 0 && this.combatState.reserve <= 0) {
            this.print("Your entire legion has been massacred. GAME OVER.", "error-text");
            this.state.flags.game_over = true;
            this.state.player.strength = 0;
            this.updateUI();
            return;
        }

        this.combatState.enemy.strength = this.combatState.enemyCenter;
        this.combatState.turn++;
        this.updateUI();
    }

    // Simulate a battle between two actors (attacker vs defender).
    // attacker may be a lightweight object representing the player.
    simulateBattle(attacker, defender) {
        const atkPower = (attacker.strength || 0) * (1 + ((attacker.martial || 3) * 0.05)) * (0.8 + Math.random() * 0.8);
        const defPower = (defender.strength || 0) * (1 + ((defender.martial || 3) * 0.05)) * (0.8 + Math.random() * 0.8);

        // Casualties proportional to opponent power
        const atkCas = Math.min(attacker.strength || 0, Math.floor(defPower * 0.25));
        const defCas = Math.min(defender.strength || 0, Math.floor(atkPower * 0.25));

        // Apply casualties
        if (attacker.id === 'player') {
            this.state.player.strength = Math.max(0, this.state.player.strength - atkCas);
            this.state.player.morale = Math.max(0, (this.state.player.morale || 50) - Math.floor(atkCas / 100));
        } else {
            const a = this.state.world.actors.find(a => a.id === attacker.id);
            if (a) a.strength = Math.max(0, a.strength - atkCas);
        }

        defender.strength = Math.max(0, defender.strength - defCas);
        defender.morale = Math.max(0, (defender.morale || 50) - Math.floor(defCas / 100));

        // Determine winner
        const atkRem = (attacker.id === 'player') ? this.state.player.strength : (this.state.world.actors.find(a => a.id === attacker.id) || {}).strength || 0;
        const defRem = defender.strength || 0;

        if (atkRem <= 0 && defRem <= 0) {
            // Both destroyed
            if (defender.id) defender.state = 'dead';
            if (attacker.id === 'player') this.print('Both sides were shattered in the fighting!', 'error-text');
            return 'draw';
        }

        if (defRem <= 0) {
            defender.state = 'dead';
            this.print(`${defender.name} was routed in battle!`, 'intel-text');
            return 'attacker';
        }

        if (atkRem <= 0) {
            if (attacker.id === 'player') this.print('Your army was routed in the assault!', 'error-text');
            else {
                const a = this.state.world.actors.find(a => a.id === attacker.id);
                if (a) a.state = 'dead';
            }
            return 'defender';
        }

        // Otherwise, compare remaining power
        if (atkRem > defRem) {
            defender.state = 'dead';
            this.print(`${defender.name} was defeated after hard fighting.`, 'intel-text');
            return 'attacker';
        } else {
            if (attacker.id === 'player') this.print('Your assault was repelled.', 'error-text');
            else {
                const a = this.state.world.actors.find(a => a.id === attacker.id);
                if (a) a.state = 'dead';
            }
            return 'defender';
        }
    }

    // Proclaim a new emperor given a candidate actor id
    proclaimEmperor(candidateId) {
        const cand = this.state.world.actors.find(a => a.id === candidateId);
        if (!cand) return;
        // Demote any existing emperor
        const oldEmp = this.state.world.actors.find(a => a.id === this.state.world.emperorId);
        if (oldEmp) {
            oldEmp.type = 'governor';
            oldEmp.realm = oldEmp.realm || 'independent';
        }
        // Promote candidate
        cand.type = 'emperor';
        cand.realm = 'emperor';
        cand.faction = 'emperor';
        cand.loyalty = Math.min(100, (cand.loyalty || 50) + 20);
        this.state.world.emperorId = cand.id;
        this.print(`${cand.name} has been acclaimed Emperor by the Senate!`, 'intel-text');
    }

    // Called when emperor dead or vacancy arises. If `force` is true,
    // run the Senate vote even if an emperor currently sits.
    processSenateIfNeeded(force = false) {
        const emperor = this.state.world.actors.find(a => a.id === this.state.world.emperorId);
        if (!force && emperor && emperor.state !== 'dead') return; // still alive
        if (!this.state.world.senate || this.state.world.senate.length === 0) {
            // Try to initialize a senate on-demand from governors or powerful actors
            const govs = this.state.world.actors.filter(a => a.type === 'governor' && a.state !== 'dead');
            if (govs.length > 0) {
                govs.sort((a,b) => ((b.wealth||0) + (b.strength||0)/2) - ((a.wealth||0) + (a.strength||0)/2));
                const senateSize = Math.min(6, Math.max(1, Math.floor(govs.length / 2)));
                this.state.world.senate = [];
                for (let i = 0; i < senateSize && i < govs.length; i++) {
                    const s = govs[i];
                    s.isSenator = true;
                    s.influence = (s.wealth || 1000) / 1000 + (s.strength || 1000) / 2000;
                    this.state.world.senate.push(s.id);
                }
                this.print(`No senate found: auto-constituted ${this.state.world.senate.length} senators from governors.`, 'intel-text');
            } else {
                // Fallback: pick top 3 eligible actors (rivals/governors/merchants) as a makeshift senate
                const elig = this.state.world.actors.filter(a => a.state !== 'dead' && ['governor','rival','merchant','brigand'].includes(a.type));
                if (elig.length > 0) {
                    elig.sort((a,b) => ((b.wealth||0) + (b.strength||0)/2) - ((a.wealth||0) + (a.strength||0)/2));
                    this.state.world.senate = elig.slice(0, Math.min(3, elig.length)).map(a => a.id);
                    this.state.world.senate.forEach(sid => {
                        const s = this.state.world.actors.find(a => a.id === sid);
                        if (s) { s.isSenator = true; s.influence = (s.wealth || 1000)/1000 + (s.strength||1000)/2000; }
                    });
                    this.print(`No senate found: created a small temporary senate (${this.state.world.senate.length}).`, 'intel-text');
                } else {
                    this.print('Call failed: No eligible actors to form a senate.', 'error-text');
                    return;
                }
            }
        }

        // Diagnostic: report senators and invocation (helps debug UI button behavior)
        try {
            this.print(`Senate called (force=${force}). Senators: ${this.state.world.senate.length}`, 'intel-text');
            const names = this.state.world.senate.map(sid => {
                const s = this.state.world.actors.find(a => a.id === sid);
                return s ? `${s.name}(${sid})` : `${sid}(missing)`;
            });
            this.print(`Senators: ${names.join(', ')}`);
        } catch (e) {
            console.error('Senate debug print failed', e);
        }

        // Build candidate list: powerful governors, rivals, player
        const candidates = [];
        // player as candidate
        candidates.push({ id: 'player', name: this.state.player.name, strength: this.state.player.strength, wealth: this.state.player.wealth, loyalty: this.state.player.loyalty || 50 });

        for (const a of this.state.world.actors) {
            if (a.state === 'dead') continue;
            if (['governor','rival'].includes(a.type) || a.type === 'emperor') {
                candidates.push({ id: a.id, name: a.name, strength: a.strength || 0, wealth: a.wealth || 0, loyalty: a.loyalty || 50 });
            }
        }

        // Each senator votes for candidate weighted by influence and candidate appeal
        const votes = new Map();
        for (const c of candidates) votes.set(c.id, 0);

        for (const senId of this.state.world.senate) {
            const senator = this.state.world.actors.find(a => a.id === senId);
            if (!senator) continue;
            // senator evaluates candidates
            let best = null; let bestScore = -Infinity;
            for (const cand of candidates) {
                const base = (cand.wealth * 0.001) + (cand.strength * 0.01) + ((cand.loyalty || 50) * 0.2);
                const rel = (senator.loyalty || 50) * 0.1 * (senator.influence || 1);
                const score = base + rel + (Math.random() * 5 - 2.5);
                if (score > bestScore) { bestScore = score; best = cand; }
            }
            if (best) votes.set(best.id, votes.get(best.id) + 1);
        }

        // Determine winner
        let winner = null; let highest = -Infinity;
        for (const [id, v] of votes.entries()) {
            if (v > highest) { highest = v; winner = id; }
        }

        if (winner) {
            if (winner === 'player') {
                // Make the player the Emperor without spawning a duplicate actor.
                this.state.world.emperorId = 'player';
                this.state.player.realm = 'emperor';
                this.state.player.faction = 'emperor';
                // Convert player-controlled provinces to the imperial realm
                for (const n of Object.values(this.state.world.nodes)) {
                    if (n.realm === 'player') n.realm = 'emperor';
                    // leave garrison_id as 'player' so getActorById works for UI/logic
                    if (n.garrison_id === 'player') {
                        n.garrison_strength = this.state.player.strength;
                    }
                }
                this.print(`${this.state.player.name} has been acclaimed Emperor!`, 'intel-text');
            } else {
                this.proclaimEmperor(winner);
            }
        }
    }

    // Emperor attempts to maintain power: bribe senators, reinforce governors
    emperorActions() {
        const emperor = this.state.world.actors.find(a => a.id === this.state.world.emperorId);
        if (!emperor || emperor.state === 'dead') return;
        // Bribe random senator if low loyalty
        if (Math.random() < 0.5 && emperor.wealth > 100) {
            const senIds = (this.state.world.senate || []).slice();
            if (senIds.length > 0) {
                const sid = senIds[Math.floor(Math.random() * senIds.length)];
                const sen = this.state.world.actors.find(a => a.id === sid);
                if (sen && (sen.loyalty || 50) < 60) {
                    const bribe = Math.min(emperor.wealth, 50 + Math.floor(Math.random() * 200));
                    emperor.wealth -= bribe;
                    sen.wealth = (sen.wealth || 0) + Math.floor(bribe * 0.6);
                    sen.loyalty = Math.min(100, (sen.loyalty || 50) + Math.floor(bribe / 20));
                    this.print(`${emperor.name} bribes ${sen.name} (+${Math.floor(bribe/20)} loyalty)`, 'intel-text');
                }
            }
        }

        // Promote or reward governors to keep them loyal
        for (const gId of emperor.subordinates || []) {
            const gov = this.state.world.actors.find(a => a.id === gId);
            if (!gov || gov.state === 'dead') continue;
            if ((gov.loyalty || 50) < 40 && emperor.wealth > 200) {
                const reward = Math.min(emperor.wealth, 100 + Math.floor(Math.random() * 200));
                emperor.wealth -= reward;
                gov.wealth = (gov.wealth || 0) + reward;
                gov.loyalty = Math.min(100, (gov.loyalty || 50) + Math.floor(reward / 50));
                this.print(`${emperor.name} rewards ${gov.name} to shore loyalty.`, 'intel-text');
            }
        }
    }

    updatePlayerStrengthFromWings() {
        this.state.player.strength = Math.max(0, this.combatState.left) + Math.max(0, this.combatState.center) + Math.max(0, this.combatState.right) + Math.max(0, this.combatState.reserve);
    }

    parse(input) {
        if (this.state.flags.game_over) {
            this.print("The game has ended. Please refresh or load a save.", "error-text");
            return;
        }

        const args = input.trim().toLowerCase().split(/\s+/);
        if (args.length === 0 || args[0] === "") return;

        const verb = args[0];
        this.print("> " + input, "command-echo");

        if (this.state.flags.in_combat) {
            if (verb === 'order') this.processCombat(args);
            else this.print("You are in combat! Use: order [wing] [tactic]");
            return;
        }

        switch (verb) {
            case 'help':
                this.print("COMMANDS:\n- look | l\n- wait [days]\n- rest (200 grain → morale)\n- march [province]\n- conquer | tax | extort\n- muster [troops] (5g/troop → more men)\n- market buy [amount] | market sell [amount] (grain ↔ gold)\n- recruit [actor name] (bribe a general, cost scales by power)\n- subordinates | status [name]\n- command [name] [march/conquer/tax/hold]");
                break;
            case 'look':
            case 'l':
                this.look();
                break;
            case 'march':
                if (args.length < 2) {
                    this.print("March where? march [province name or id]", 'error-text');
                    break;
                }
                const targetInput = args.slice(1).join(' ');
                let targetNode = Object.values(this.state.world.nodes).find(n => n.id === targetInput);
                if (!targetNode) {
                    targetNode = Object.values(this.state.world.nodes).find(n => n.name.toLowerCase() === targetInput.toLowerCase());
                }
                if (!targetNode) {
                    this.print("Unknown province.", 'error-text');
                    break;
                }
                this.marchNode(targetNode.id);
                break;
            case 'conquer':
                this.conquer();
                break;
            case 'tax':
                this.tax();
                break;
            case 'extort':
                this.extort();
                break;
            case 'market':
                if (args[1] === 'buy') this.marketBuy(parseInt(args[2]) || null);
                else if (args[1] === 'sell') this.marketSell(parseInt(args[2]) || 0);
                else this.print("Use: market buy [amount] | market sell [grain amount]");
                break;
            case 'wait': {
                const waitDays = Math.min(30, Math.max(1, parseInt(args[1]) || 1));
                this.print(`You wait ${waitDays} day${waitDays > 1 ? 's' : ''}...`);
                this.passTime(waitDays);
                if (!this.state.flags.game_over) this.look();
                break;
            }
            case 'rest':
                this.rest();
                break;
            case 'muster': {
                const amount = Math.max(1, parseInt(args[1]) || 100);
                const cost = amount * 5;
                if (this.state.player.wealth < cost) {
                    this.print(`You need ${cost} gold to muster ${amount} men. (You have ${this.state.player.wealth}g)`, 'error-text');
                } else {
                    this.state.player.wealth -= cost;
                    this.state.player.strength += amount;
                    this.print(`You spend ${cost} gold to muster ${amount} men. Strength: ${this.state.player.strength}.`);
                    this.passTime(1);
                }
                break;
            }
            case 'recruit':
                this.recruit(args.slice(1).join(" "));
                break;
            case 'call_senate':
            case 'senate':
                // Only callable if you control Rome and there is no living emperor
                const romeId = this.state.world.romeNode || 'i';
                const controlsRome = this.state.world.nodes[romeId] && this.state.world.nodes[romeId].realm === 'player';
                if (!controlsRome) {
                    this.print('You must control Rome to call the Senate.', 'error-text');
                    break;
                }
                // Is there a living emperor (actor) other than player?
                const empId = this.state.world.emperorId;
                let livingEmp = false;
                if (empId) {
                    if (empId === 'player') livingEmp = true;
                    else {
                        const empActor = this.state.world.actors.find(a => a.id === empId);
                        if (empActor && empActor.state !== 'dead') livingEmp = true;
                    }
                }
                if (livingEmp) {
                    this.print('You cannot call the Senate while a living Emperor exists.', 'error-text');
                    break;
                }

                this.print('Calling the Senate...', 'intel-text');
                try {
                    this.processSenateIfNeeded(true);
                } catch (e) {
                    console.error('call_senate error', e);
                    this.print('Senate call failed (see console).', 'error-text');
                }
                this.updateUI();
                this.look();
                break;
            case 'subordinates':
                this.listSubordinates();
                break;
            case 'status':
                this.showStatus(args.slice(1).join(" "));
                break;
            case 'command':
                if (args.length < 3) {
                    this.print("Use: command [subordinate name] [march [province] | conquer | tax | hold]", 'error-text');
                } else {
                    const subName = args[1];
                    const action = args.slice(2);
                    this.commandSubordinate(subName, action);
                }
                break;
            default:
                this.print("I don't understand. Type 'help'.", "error-text");
        }
    }

    marchNode(targetId) {
        const currentNode = this.state.world.nodes[this.state.player.node];
        
        if (currentNode.neighbors.includes(targetId)) {
            this.state.player.node = targetId;
            this.print("The legion marches...");
            this.passTime(2);
            if (!this.state.flags.game_over) this.look();
            return;
        }

        // If not adjacent, attempt to find a path and move one step along it.
        try {
            const nextStep = this.findNextStepTo(currentNode.id, targetId);
            if (nextStep) {
                this.state.player.node = nextStep;
                this.print(`You begin a march towards ${targetId} (moving to ${nextStep}).`);
                this.passTime(3);
                if (!this.state.flags.game_over) this.look();
                return;
            }
        } catch (e) {
            // fall through to error message
        }

        this.print(`You cannot march there. '${targetId}' is not reachable from here.`, "error-text");
    }

    conquer() {
        const node = this.state.world.nodes[this.state.player.node];
        if (node.realm === 'player') {
            this.print("You already own this province.");
            return;
        }
        // Only consider a defender if they actually control the province (garrison or owner)
        const defender = this.state.world.actors.find(a => a.node === node.id && a.state !== 'dead' && (a.realm === node.realm || node.garrison_id === a.id));

        if (defender) {
            this.print(`You declare war on ${defender.name}!`);
            // Launch interactive combat so player can use wings/tactics
            this.startCombat(defender);
            // mark that this combat is for conquering the current province
            this.combatState.conquering = true;
            return; // combat flow will handle passTime/look on resolution
        } else {
            node.realm = 'player';
            node.garrison_id = 'player';
            node.garrison_strength = this.state.player.strength;
            this.print(`You easily occupy the undefended province of ${node.name}.`, "room");
            this.passTime(1);
        }
    }

    tax() {
        const node = this.state.world.nodes[this.state.player.node];
        if (node.realm !== 'player') {
            this.print("You can only tax provinces in your realm.", "error-text");
            return;
        }
        const collected = Math.floor(node.wealth * 0.1);
        this.state.player.wealth += collected;
        node.wealth -= collected;
        node.unrest += 10;
        this.print(`You collected ${collected} gold in taxes. Unrest increases.`);
        this.passTime(1);
    }

    extort() {
        const node = this.state.world.nodes[this.state.player.node];
        const collected = Math.floor(node.wealth * 0.5);
        this.state.player.wealth += collected;
        node.wealth -= collected;
        node.unrest += 50;
        this.print(`Your legion brutally extorts the locals for ${collected} gold! Massive unrest!`);
        // Track diplomacy — locals remember extortion
        const localActor = this.state.world.actors.find(a => a.node === node.id && a.state !== 'dead' && a.id !== 'player');
        if (localActor) {
            if (!this.state.player.diplomacy) this.state.player.diplomacy = {};
            const rel = this.state.player.diplomacy[localActor.id] || { relation: 'neutral', trust: 50 };
            rel.trust = Math.max(0, (rel.trust || 50) - 30);
            rel.relation = rel.trust < 20 ? 'hostile' : 'distrustful';
            this.state.player.diplomacy[localActor.id] = rel;
        }
        this.passTime(1);
    }

    marketBuy() {
        // Accept optional amount (grain to buy). Default: 200 grain for 100 gold.
        let amount = 200;
        if (arguments.length > 0 && Number.isInteger(arguments[0]) && arguments[0] > 0) amount = arguments[0];
        const pricePerGrain = 0.5; // 0.5 gold per grain => 100 gold = 200 grain
        const cost = Math.ceil(amount * pricePerGrain);
        if (this.state.player.wealth >= cost) {
            this.state.player.wealth -= cost;
            this.state.player.grain += amount;
            this.print(`You bought ${amount} grain for ${cost} gold.`);
            this.passTime(1);
        } else {
            this.print(`You don't have enough gold (Need ${cost}).`, "error-text");
        }
    }

    recruit(name) {
        if (!name) {
            this.print("Recruit who?");
            return;
        }
        
        const target = this.state.world.actors.find(a => a.name.toLowerCase().includes(name.toLowerCase()) && a.node === this.state.player.node && a.state !== 'dead');
        
        if (!target) {
            this.print("No one by that name is here.", "error-text");
            return;
        }

        if (target.type === 'emperor') {
            this.print("You cannot recruit the Emperor!", "error-text");
            return;
        }
        
        if (this.state.player.subordinates.includes(target.id)) {
            this.print("This general is already under your command!", "error-text");
            return;
        }

        // Cost scales with target power
        const baseCost = 200;
        const strengthCost = Math.floor((target.strength || 0) / 10);
        const martialCost = (target.martial || 0) * 50;
        const recruitCost = baseCost + strengthCost + martialCost;

        if (this.state.player.wealth >= recruitCost) {
            this.state.player.wealth -= recruitCost;

            // If the target controls a named realm (e.g., rival_x), convert all provinces of that realm to player
            if (target.realm && target.realm !== 'independent' && target.realm !== 'player') {
                const oldRealm = target.realm;
                for (const n of Object.values(this.state.world.nodes)) {
                    if (n.realm === oldRealm) {
                        n.realm = 'player';
                        n.garrison_id = target.id;
                        n.garrison_strength = target.strength || 0;
                    }
                }
            }

            target.type = 'subordinate';
            target.realm = 'player';
            target.superior = 'player';
            target.loyalty = 70 + Math.floor(Math.random() * 30);
            target.subordinates = target.subordinates || [];
            this.state.player.subordinates.push(target.id);
            // Track diplomacy
            if (!this.state.player.diplomacy) this.state.player.diplomacy = {};
            this.state.player.diplomacy[target.id] = { relation: 'subordinate', trust: target.loyalty, since: this.state.day };
            this.print(`You spent ${recruitCost} gold. ${target.name} is now your subordinate general!`, "room");
            this.print(`${target.name}'s Strength: ${target.strength}, Loyalty: ${target.loyalty}`, "intel-text");
        } else {
            this.print(`You need at least ${recruitCost} gold to bribe this general into your service.`, "error-text");
        }
        this.passTime(1);
    }

    listSubordinates() {
        if (this.state.player.subordinates.length === 0) {
            this.print("You have no subordinate generals.");
            return;
        }
        this.print("Your Subordinate Generals:");
        this.state.player.subordinates.forEach(subId => {
            const sub = this.state.world.actors.find(a => a.id === subId);
            if (sub && sub.state !== 'dead') {
                const node = this.state.world.nodes[sub.node];
                this.print(`  ${sub.name}: Str ${sub.strength} | Loy ${sub.loyalty} | Gold ${sub.wealth} | at ${node.name}`);
            }
        });
    }

    showStatus(name) {
        if (!name) {
            this.print("Status of whom?");
            return;
        }
        const actor = this.state.world.actors.find(a => a.name.toLowerCase().includes(name.toLowerCase()));
        if (!actor) {
            this.print("Actor not found.", "error-text");
            return;
        }
        const node = this.state.world.nodes[actor.node];
        this.print(`=== ${actor.name} ===`);
        this.print(`Type: ${actor.type} | Personality: ${actor.personality}`);
        this.print(`Strength: ${actor.strength} | Wealth: ${actor.wealth}`);
        this.print(`Loyalty: ${actor.loyalty} | Ambition: ${actor.ambition} | Martial: ${actor.martial}`);
        this.print(`Location: ${node.name} | State: ${actor.state}`);
    }

    commandSubordinate(name, actionArgs) {
        const sub = this.state.world.actors.find(a => a.name.toLowerCase().includes(name.toLowerCase()) && this.state.player.subordinates.includes(a.id));
        if (!sub) {
            this.print("Subordinate not found.", "error-text");
            return;
        }
        
        const action = actionArgs[0];
        
        if (action === 'march' && actionArgs.length > 1) {
            const target = Object.values(this.state.world.nodes).find(n => n.id === actionArgs[1] || n.name.toLowerCase() === actionArgs.slice(1).join(' ').toLowerCase());
            if (!target) {
                this.print("Unknown target province.", "error-text");
                return;
            }
            sub.target_province = target.id;
            this.print(`${sub.name} has been ordered to march to ${target.name}.`);
        } else if (action === 'conquer') {
            sub.target_province = null;
            sub.orders = 'conquer';
            this.print(`${sub.name} has been ordered to conquer the current province.`);
        } else if (action === 'tax') {
            sub.orders = 'tax';
            this.print(`${sub.name} has been ordered to collect taxes.`);
        } else if (action === 'hold') {
            sub.orders = 'hold';
            sub.target_province = null;
            this.print(`${sub.name} has been ordered to hold position.`);
        } else {
            this.print("Use: command [name] [march [province] | conquer | tax | hold]", "error-text");
        }
        // Apply a short tick so subordinates execute simple orders immediately
        try {
            this.passTime(1);
            if (!this.state.flags.game_over) this.look();
        } catch (e) {
            console.error('error executing subordinate action tick', e);
        }
    }

    rest() {
        const grainCost = 200;
        if (this.state.player.grain < grainCost) {
            this.print(`You need at least ${grainCost} grain to rest properly. (market buy to restock)`, "error-text");
            return;
        }
        this.state.player.grain -= grainCost;
        const moraleGain = Math.min(30, 100 - this.state.player.morale);
        this.state.player.morale = Math.min(100, this.state.player.morale + moraleGain);
        this.print(`Your legion rests and recuperates. Morale +${moraleGain}. (${grainCost} grain consumed.)`);
        this.passTime(3);
        if (!this.state.flags.game_over) this.look();
    }

    marketSell(amount) {
        if (!amount || amount <= 0) {
            this.print("Specify an amount: market sell [grain amount]", "error-text");
            return;
        }
        if (this.state.player.grain < amount) {
            this.print(`You only have ${this.state.player.grain} grain to sell.`, "error-text");
            return;
        }
        const gold = amount * 2;
        this.state.player.grain -= amount;
        this.state.player.wealth += gold;
        this.print(`Sold ${amount} grain for ${gold} gold at market rates.`);
        this.passTime(1);
    }

    checkObjectives() {
        if (!this.state.player.objectives) this.state.player.objectives = [];

        const playerProvinces = Object.values(this.state.world.nodes).filter(n => n.realm === 'player');
        const controlsRome = this.state.world.nodes['i'] && this.state.world.nodes['i'].realm === 'player';
        const subCount = this.state.player.subordinates.length;
        const emperorId = this.state.world.emperorId;
        const emperor = emperorId && emperorId !== 'player' ? this.state.world.actors.find(a => a.id === emperorId) : null;
        const emperorDead = !emperorId || (emperorId !== 'player' && (!emperor || emperor.state === 'dead'));

        // Victory objective: be Emperor and hold >50% of provinces (imperial unity)
        const totalProvinces = Object.keys(this.state.world.nodes).length;
        const imperialProvinces = Object.values(this.state.world.nodes).filter(n => n.realm === 'emperor').length;
        const playerIsEmperor = (this.state.world.emperorId === 'player');

        const definitions = [
            { id: 'seize_rome',    label: 'Seize Rome (Latium et Campania)',    done: controlsRome },
            { id: 'ten_provinces', label: 'Control 10 Provinces',               done: playerProvinces.length >= 10 },
            { id: 'defeat_emp',    label: 'Defeat the Emperor in Battle',        done: emperorDead },
            { id: 'imperial_unity', label: 'Be Emperor and control >50% provinces', done: playerIsEmperor && imperialProvinces > (totalProvinces/2) },
            { id: 'three_generals',label: 'Command 3 Subordinate Generals',      done: subCount >= 3 },
            { id: 'wealthy',       label: 'Accumulate 10,000 Gold',             done: this.state.player.wealth >= 10000 },
        ];

        definitions.forEach(def => {
            const existing = this.state.player.objectives.find(o => o.id === def.id);
            if (!existing) {
                this.state.player.objectives.push({ ...def });
            } else if (!existing.done && def.done) {
                existing.done = true;
                this.print(`★ OBJECTIVE COMPLETE: ${def.label}`, 'room');
                if (def.id === 'imperial_unity') {
                    this.print('VICTORY — You have unified the Roman provinces under your rule!', 'intel-text');
                    this.state.flags.game_over = true;
                }
            } else {
                existing.done = def.done;
                existing.label = def.label;
            }
        });
    }
}

// Helper: smart 2-4 char abbreviation for province labels on the map
function abbreviateProvince(name) {
    const stop = new Set(['et', 'at', 'de', 'del', 'el', 'und', 'and']);
    const words = name.split(/[\s&]+/).filter(w => w.length > 0 && !stop.has(w.toLowerCase()));
    if (words.length === 1) return name.substring(0, 4).toUpperCase();
    return words.map(w => w[0]).join('').toUpperCase();
}
