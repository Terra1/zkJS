document.addEventListener('DOMContentLoaded', () => {
    const outputDiv = document.getElementById('output');
    const inputField = document.getElementById('command-input');
    
    // UI elements
    const uiLegion = document.getElementById('status-legion');
    const uiResources = document.getElementById('status-resources');
    const minimap = document.getElementById('minimap');
    
    const uiDate = document.getElementById('status-date');
    const uiLocation = document.getElementById('status-location');
    const uiIntel = document.getElementById('status-intel');
    
    const uiBureaucracy = document.getElementById('status-bureaucracy');
    const uiEconomy = document.getElementById('status-economy');

    // Tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.getAttribute('data-target')).classList.add('active');
        });
    });

    function outputCallback(text, type = 'normal') {
        const p = document.createElement('p');
        p.textContent = text;
        if (type) p.classList.add(type);
        outputDiv.appendChild(p);
        outputDiv.scrollTop = outputDiv.scrollHeight;
    }

    let mapInitialized = false;

    function updateUICallback(state) {
        uiLegion.innerHTML = `<strong>Strength:</strong> ${state.player.strength} men<br><strong>Morale:</strong> ${state.player.morale}%<br><strong>Subordinates:</strong> ${state.player.subordinates.length}`;
        uiResources.innerHTML = `<strong>Wealth:</strong> ${state.player.wealth} gold<br><strong>Grain:</strong> ${state.player.grain} bushels`;
        
        if (state.world && state.world.nodes && Object.keys(state.world.nodes).length > 0) {
            
            // Render Map
            if (!mapInitialized) {
                minimap.innerHTML = '';
                
                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.classList.add("map-polygon-svg");
                svg.setAttribute("viewBox", "0 0 100 100");
                svg.style.width = "100%";
                svg.style.height = "100%";
                svg.style.position = "absolute";
                svg.style.top = "0";
                svg.style.left = "0";

                for (const [id, node] of Object.entries(state.world.nodes)) {
                    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
                    group.setAttribute("id", `map-poly-${id}`);
                    group.style.cursor = "pointer";
                    
                    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
                    title.textContent = node.name;
                    group.appendChild(title);
                    
                    group.addEventListener('click', () => {
                        inputField.value = `march ${id}`;
                        inputField.focus();
                    });

                    node.polygons.forEach(pts => {
                        const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
                        poly.setAttribute("points", pts);
                        group.appendChild(poly);
                    });
                    
                    svg.appendChild(group);
                    
                    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                    text.setAttribute("x", `${node.cx}`);
                    text.setAttribute("y", `${node.cy}`);
                    text.setAttribute("text-anchor", "middle");
                    text.setAttribute("dominant-baseline", "middle");
                    text.setAttribute("font-size", "1.5");
                    text.setAttribute("font-weight", "bold");
                    text.setAttribute("fill", "rgba(0,0,0,0.7)");
                    text.setAttribute("pointer-events", "none");
                    text.textContent = abbreviateProvince(node.name);
                    svg.appendChild(text);
                }
                minimap.appendChild(svg);
                mapInitialized = true;
            }

            // Update Map Colors: color by controlling actor when possible
            const emperorId = state.world && state.world.emperorId;
            const actorColor = (key) => {
                if (!key) return '#666666';
                if (key === 'player') return '#33ff33';
                if (key === emperorId || key === 'emperor') return '#ff3333';
                if (String(key).startsWith('horde')) return '#ff8800';
                // deterministic HSL based on key string
                let hash = 0;
                for (let i = 0; i < String(key).length; i++) hash = (hash * 31 + String(key).charCodeAt(i)) >>> 0;
                const h = hash % 360;
                return `hsl(${h},70%,50%)`;
            };

            for (const [id, tile] of Object.entries(state.world.nodes)) {
                const poly = document.getElementById(`map-poly-${id}`);
                if (!poly) continue;

                // Prefer political realm ownership for coloring (player/emperor),
                // fall back to garrison owner if no clear realm owner.
                let ownerKey = null;
                if (tile.realm === 'player') ownerKey = 'player';
                else if (tile.realm === 'emperor') ownerKey = emperorId || 'emperor';
                else if (tile.garrison_id) ownerKey = tile.garrison_id;
                else ownerKey = tile.realm;

                poly.setAttribute("fill", actorColor(ownerKey));
                
                if (id === state.player.node) {
                    poly.setAttribute("stroke", "#fff");
                    poly.setAttribute("stroke-width", "1.5");
                    poly.setAttribute("stroke-dasharray", "2,1");
                } else {
                    poly.setAttribute("stroke", "#000");
                    poly.setAttribute("stroke-width", "0.5");
                    poly.removeAttribute("stroke-dasharray");
                }
            }

            // Intel Tab
            const currentNode = state.world.nodes[state.player.node];
            uiLocation.innerHTML = `<strong>Region:</strong> ${currentNode.name}<br><strong>Realm Owner:</strong> ${currentNode.realm}`;
            uiDate.innerHTML = `<strong>Day:</strong> ${state.day}`;
            
            const emperorForIntel = state.world.actors.find(a => a.id === state.world.emperorId);
            uiIntel.innerHTML = `<strong>Emperor:</strong> ${emperorForIntel && emperorForIntel.state !== 'dead' ? emperorForIntel.strength : 'DEAD'} troops<br><br><strong>Active Threats:</strong><br>`;
            state.world.actors.filter(a => (a.type === 'rival' || a.type === 'barbarian') && a.state !== 'dead').forEach(r => {
                const threatNode = state.world.nodes[r.node];
                uiIntel.innerHTML += `- ${r.name} (${r.type})<br>  [Str: ${r.strength}] at ${threatNode ? threatNode.name : 'Unknown'}<br>`;
            });

            // Bureaucracy Tab: render hierarchy and Senate
            uiBureaucracy.innerHTML = `<strong>Imperial Bureaucracy</strong><br><br>`;
            const actorsById = {};
            // Include actors and a pseudo-actor for the player so UI trees can reference 'player'
            state.world.actors.forEach(a => actorsById[a.id] = a);
            actorsById['player'] = { id: 'player', name: state.player.name, node: state.player.node, strength: state.player.strength, loyalty: state.player.loyalty };

            function renderActorTree(rootId, depth = 0) {
                const a = actorsById[rootId];
                if (!a || a.state === 'dead') return '';
                let out = '';
                out += `${'&nbsp;'.repeat(depth*4)}<strong>${a.name}</strong> (${a.type}) - Str:${a.strength} Loy:${a.loyalty}<br>`;
                // find subordinates
                state.world.actors.filter(x => x.superior === rootId).forEach(sub => {
                    out += renderActorTree(sub.id, depth + 1);
                });
                return out;
            }

            // Emperor root
            const emperorActor = state.world.actors.find(a => a.id === state.world.emperorId);
            if (emperorActor) uiBureaucracy.innerHTML += renderActorTree(emperorActor.id, 0);

            // Player's sub-tree (if not emperor)
            if (!emperorActor || emperorActor.id !== state.player.id) {
                uiBureaucracy.innerHTML += `<br><strong>Your House</strong><br>`;
                uiBureaucracy.innerHTML += renderActorTree('player', 0) || `You: Str:${state.player.strength} Loy:${state.player.loyalty}<br>`;
            }

            // Senate display + control
            uiBureaucracy.innerHTML += `<br><strong>Senate</strong><br>`;
            if (state.world.senate && state.world.senate.length > 0) {
                state.world.senate.forEach(sid => {
                    const s = actorsById[sid];
                    if (!s) return;
                    uiBureaucracy.innerHTML += `- ${s.name} (${s.node ? state.world.nodes[s.node].name : 'Unknown'}) Loy:${s.loyalty} Infl:${(s.influence||0).toFixed(2)}<br>`;
                });
            } else {
                uiBureaucracy.innerHTML += `<em>No senate constituted.</em><br>`;
            }
            uiBureaucracy.innerHTML += `<div style="margin-top:6px"><button id="call-senate-btn">Call Senate (vote)</button></div>`;

            // Attach a one-time event handler to the Call Senate button
            setTimeout(() => {
                const btn = document.getElementById('call-senate-btn');
                if (btn && !btn.dataset.attached) {
                    btn.addEventListener('click', () => {
                        // Use the engine command path so UI shows command echo and results
                        engine.parse('call_senate');
                    });
                    btn.dataset.attached = '1';
                }
            }, 0);

            // Economy Tab
            let globalWealth = 0;
            let playerWealth = 0;
            for (const tile of Object.values(state.world.nodes)) {
                globalWealth += tile.wealth;
                if (tile.realm === 'player') playerWealth += tile.wealth;
            }
            
            uiEconomy.innerHTML = `<strong>Macro Economy Simulation</strong><br><br>`;
            uiEconomy.innerHTML += `<strong>Global Empire Wealth:</strong> ${globalWealth}<br>`;
            uiEconomy.innerHTML += `<strong>Your Realm Wealth:</strong> ${playerWealth}<br><br>`;
            uiEconomy.innerHTML += `<em>Local Province Data:</em><br>`;
            uiEconomy.innerHTML += `Wealth: ${currentNode.wealth}<br>`;
            uiEconomy.innerHTML += `Unrest: ${currentNode.unrest}%<br>`;
            uiEconomy.innerHTML += `Grain Stockpile: ${currentNode.grain || 0}<br>`;
            uiEconomy.innerHTML += `Grain Production: +${currentNode.grain_production || 0}/day<br>`;
            uiEconomy.innerHTML += `<br><em>Your Army:</em><br>`;
            uiEconomy.innerHTML += `Grain: ${state.player.grain} bushels<br>`;
            uiEconomy.innerHTML += `Daily Cost: ${state.player.daily_cost} gold<br>`;
        }
    }

    const engine = new Engine(GameContent, outputCallback, updateUICallback);
    
    outputCallback("--- zkJS: GRAND STRATEGY ---", "room");
    engine.look();

    inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const command = inputField.value;
            if (command.trim() !== '') {
                engine.parse(command);
                inputField.value = '';
            }
        }
    });

    document.getElementById('save-btn').addEventListener('click', () => {
        const saveData = engine.getSaveData();
        const blob = new Blob([JSON.stringify(saveData)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "zkJS_GSG_save.json";
        a.click();
        outputCallback("Game saved.", "intel-text");
    });

    document.getElementById('load-file').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                mapInitialized = false;   // Reset so map re-renders with loaded state
                minimap.innerHTML = '';   // Clear old SVG
                engine.loadState(JSON.parse(ev.target.result));
                outputCallback("Game loaded.", "intel-text");
            } catch (err) {
                outputCallback("Error loading save.", "error-text");
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });
});
