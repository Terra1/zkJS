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
        this.updateUI();
    }

    getSaveData() {
        return this.state;
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
                strength: 200 + Math.floor(Math.random() * 300), wealth: 2000 + Math.floor(Math.random() * 1000), grain: 600,
                loyalty: 0, ambition: 60, martial: 1,
                personality: 'pragmatic', state: 'trading', subordinates: [],
                orders: 'trade', trade_networks: [],
                daily_cost: 10, supply_level: 1.0, morale: 80
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
                gov.wealth += collected;
                govNode.wealth -= collected;
                govNode.unrest += taxRate * 5;  // Taxation causes unrest
                
                // Governor takes cut to self, remainder to emperor
                const imperialCut = Math.floor(collected * 0.5);
                gov.wealth += imperialCut;
                emperorIncome += imperialCut;
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
                if (defender && defender.strength > sub.strength * 0.8) {
                    sub.strength -= Math.floor(defender.strength * 0.3);
                    sub.morale -= 10;
                    if (sub.strength <= 0) sub.state = 'dead';
                } else {
                    node.realm = 'player';
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
            if (actor.state === 'dead' || actor.type === 'player') return;

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

                // Governors slowly recruit if wealthy
                if (actor.wealth > 150 && Math.random() < 0.2) {
                    actor.strength += 50 + Math.floor(Math.random() * 100);
                    actor.wealth -= 100;
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

                const emperorStr = emperor && emperor.state !== 'dead' ? emperor.strength : 0;

                if (actor.phase === 'consolidate') {
                    // Expand locally — prefer unowned or weak adjacent provinces
                    const currNode = nodes[actor.node];
                    const localTargets = currNode.neighbors.filter(nId => {
                        const n = nodes[nId];
                        if (!n) return false;
                        if (n.realm === actor.realm) return false;
                        if (n.realm === 'player') return false;
                        const g = n.garrison_id ? actors.find(a => a.id === n.garrison_id) : null;
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
                                const g = n.garrison_id ? actors.find(a => a.id === n.garrison_id) : null;
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

                // Grow horde when well-fed (gold → recruits)
                if (actor.grain > actor.strength / 80 && actor.wealth > 100 && Math.random() < 0.4) {
                    const spend = Math.min(actor.wealth - 50, 300);
                    actor.strength += Math.floor(spend / 10);
                    actor.wealth -= spend;
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
                
                // Pillar territory and capture grain
                if (node.realm !== actor.realm && !node.realm.startsWith('horde')) {
                    const plunder = Math.floor(node.wealth * 0.2);
                    actor.wealth += plunder;
                    node.wealth -= plunder;
                    
                    const grainCapture = Math.floor(node.grain * 0.5);
                    actor.grain += grainCapture;
                    node.grain -= grainCapture;
                    
                    node.realm = actor.realm;
                    node.unrest = 0;
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
            if (actor.state === 'dead' && actor.garrison_id) {
                // Find all nodes where this actor was garrison
                for (const nodeId in nodes) {
                    const node = nodes[nodeId];
                    if (node.garrison_id === actor.id) {
                        node.garrison_id = null;
                        node.garrison_strength = 0;
                        // Province reverts to independent ONLY if no other owner
                        if (node.realm === actor.realm) {
                            node.realm = 'independent';
                            node.unrest = Math.floor(Math.random() * 30);
                        }
                    }
                }
            }
        });

        // ===== PHASE 8: BARBARIAN SPAWN =====
        if (Math.random() < 0.05) {
            const bIdx = Math.floor(Math.random() * this.content.barbarianNames.length);
            const bName = this.content.barbarianNames[bIdx];
            // Use actual province IDs from roman_map.js
            const edgeNodes = ['britannia', 'belgica', 'germania_superior', 'raetia', 'dacia', 'moesia_inferior', 'bithynia_et_pontus', 'armenia_mesopotamia', 'arabia', 'mauretania_tingitana'].filter(n => nodes[n]);
            if (edgeNodes.length > 0) {
                const spawnNode = edgeNodes[Math.floor(Math.random() * edgeNodes.length)];
                actors.push({
                    id: this.generateId(), type: 'barbarian', name: `${bName}`,
                    node: spawnNode, realm: `horde_${bName}`,
                    strength: 4000 + Math.floor(Math.random() * 10000), 
                    wealth: 200, grain: 400, supply_level: 1.0, 
                    daily_cost: 20, morale: 80,
                    loyalty: 0, ambition: 100, martial: 8,
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

        this.print(`Your ${wing} inflicted ${pDamage} casualties and took ${eDamage}.`);

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
                this.print("COMMANDS:\n- look | l\n- wait [days]\n- rest (200 grain → morale)\n- march [province]\n- conquer | tax | extort\n- muster [troops] (10g/troop → more men)\n- market buy (100g → 200 grain) | market sell [amount] (grain → gold)\n- recruit [actor name] (bribe a general, 500g)\n- subordinates | status [name]\n- command [name] [march/conquer/tax/hold]");
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
                if (args[1] === 'buy') this.marketBuy();
                else if (args[1] === 'sell') this.marketSell(parseInt(args[2]) || 0);
                else this.print("Use: market buy | market sell [grain amount]");
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
                const cost = amount * 10;
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
        } else {
            this.print(`You cannot march there. '${targetId}' is not an adjacent province.`, "error-text");
        }
    }

    conquer() {
        const node = this.state.world.nodes[this.state.player.node];
        if (node.realm === 'player') {
            this.print("You already own this province.");
            return;
        }

        const defender = this.state.world.actors.find(a => a.node === node.id && a.state !== 'dead');
        
        if (defender) {
            this.print(`You declare war on ${defender.name}!`);
            this.startCombat(defender);
            this.combatState.conquering = true;
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
        if (this.state.player.wealth >= 100) {
            this.state.player.wealth -= 100;
            this.state.player.grain += 200;
            this.print("You bought 200 grain for 100 gold.");
            this.passTime(1);
        } else {
            this.print("You don't have enough gold (Need 100).", "error-text");
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

        if (this.state.player.wealth >= 500) {
            this.state.player.wealth -= 500;
            target.type = 'subordinate';
            target.realm = 'player';
            target.loyalty = 70 + Math.floor(Math.random() * 30);
            target.subordinates = target.subordinates || [];
            this.state.player.subordinates.push(target.id);
            // Track diplomacy
            if (!this.state.player.diplomacy) this.state.player.diplomacy = {};
            this.state.player.diplomacy[target.id] = { relation: 'subordinate', trust: target.loyalty, since: this.state.day };
            this.print(`You spent 500 gold. ${target.name} is now your subordinate general!`, "room");
            this.print(`${target.name}'s Strength: ${target.strength}, Loyalty: ${target.loyalty}`, "intel-text");
        } else {
            this.print("You need at least 500 gold to bribe a general into your service.", "error-text");
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
        const emperor = this.state.world.actors.find(a => a.id === this.state.world.emperorId);
        const emperorDead = !emperor || emperor.state === 'dead';

        const definitions = [
            { id: 'seize_rome',    label: 'Seize Rome (Latium et Campania)',    done: controlsRome },
            { id: 'ten_provinces', label: 'Control 10 Provinces',               done: playerProvinces.length >= 10 },
            { id: 'defeat_emp',    label: 'Defeat the Emperor in Battle',        done: emperorDead },
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
