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

            // Update Map Colors
            for (const [id, tile] of Object.entries(state.world.nodes)) {
                const poly = document.getElementById(`map-poly-${id}`);
                if (!poly) continue;
                
                let fill = '#333';
                if (tile.realm === 'player') fill = '#33ff33';
                else if (tile.realm === 'emperor') fill = '#ff3333';
                else if (tile.realm.startsWith('rival')) fill = '#ffff33';
                else if (tile.realm.startsWith('horde')) fill = '#ff8800';
                else fill = '#8888ff';
                
                poly.setAttribute("fill", fill);
                
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
            
            const emp = state.world.actors.find(a => a.id === state.world.emperorId);
            uiIntel.innerHTML = `<strong>Emperor:</strong> ${emp && emp.state !== 'dead' ? emp.strength : 'DEAD'} troops<br><br><strong>Active Threats:</strong><br>`;
            state.world.actors.filter(a => (a.type === 'rival' || a.type === 'barbarian') && a.state !== 'dead').forEach(r => {
                const threatNode = state.world.nodes[r.node];
                uiIntel.innerHTML += `- ${r.name} (${r.type})<br>  [Str: ${r.strength}] at ${threatNode ? threatNode.name : 'Unknown'}<br>`;
            });

            // Bureaucracy Tab
            uiBureaucracy.innerHTML = `<strong>Imperial Bureaucracy</strong><br><br>`;
            const livingActors = state.world.actors.filter(a => a.state !== 'dead' && a.type !== 'emperor');
            livingActors.forEach(a => {
                const actNode = state.world.nodes[a.node];
                uiBureaucracy.innerHTML += `<span style="color:#ffaa00">${a.name}</span> (${a.type})<br>`;
                uiBureaucracy.innerHTML += `  Personality: ${a.personality}<br>`;
                uiBureaucracy.innerHTML += `  Stats: Loyalty ${a.loyalty} | Ambition ${a.ambition} | Martial ${a.martial}<br>`;
                uiBureaucracy.innerHTML += `  Army: ${a.strength} | Location: ${actNode ? actNode.name : 'Unknown'}<br><br>`;
            });

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
