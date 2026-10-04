        // Lista de verificación previa (Avance 3). El estado vive solo en memoria.
        (function () {
            var contenedor = document.getElementById("pg-grupos");
            if (!contenedor) return;

            var ICONOS = {
                seguridad: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
                vehiculo: '<path d="M5 17h14M6 17l1.5-5h9L18 17M4 17v2M20 17v2"/><circle cx="8" cy="17" r="1.6"/><circle cx="16" cy="17" r="1.6"/><path d="M9 12l1-3h4l1 3"/>',
                telefono: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><line x1="11" y1="18" x2="13" y2="18"/>',
                entorno: '<path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h8"/>',
                cierre: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>'
            };

            var GRUPOS = [
                { id: "seguridad", nombre: "Seguridad", items: [
                    ["Vehículo estacionado, freno de mano puesto, en P o neutral", "El motor va a acelerarse con el cofre abierto y alguien cerca. El vehículo no debe poder moverse."],
                    ["Lugar abierto o bien ventilado", "Con el motor encendido en un espacio cerrado se acumula monóxido de carbono, que no se ve ni se huele."],
                    ["Manos, ropa y teléfono lejos del ventilador, bandas y escape", "El ventilador puede encenderse solo en cualquier momento, y el múltiple y el escape queman."],
                    ["Una segunda persona lista para acelerar", "Quien graba no puede acelerar al mismo tiempo. La toma B necesita a alguien en el asiento."]
                ]},
                { id: "vehiculo", nombre: "Vehículo", items: [
                    ["Motor a temperatura de operación", "Un motor frío suena distinto. Unos 10 minutos de manejo, o hasta que el indicador de temperatura se estabilice."],
                    ["Aire acondicionado, ventilación y radio apagados", "El compresor del aire y el ventilador agregan sonidos que no son del motor."],
                    ["Ventanas cerradas", "Reduce el ruido que entra y sale de la cabina durante la toma."]
                ]},
                { id: "telefono", nombre: "Teléfono", items: [
                    ["App configurada en WAV mono a 44.1 o 48 kHz", "Las grabadoras de fábrica suelen guardar en M4A o AAC. El pipeline no los acepta y esos formatos eliminan detalle del sonido."],
                    ["Reducción de ruido y efectos desactivados", "Esos filtros están hechos para voz y pueden borrar justo los sonidos del motor que buscamos."],
                    ["Modo avión activado", "Una llamada o notificación interrumpe la grabación o mete sonidos a la toma."],
                    ["Batería y espacio suficientes", "30 segundos en WAV mono a 44.1 kHz ocupan unos 2.6 MB. Una sesión con las cuatro tomas ocupa menos de 30 MB."],
                    ["Micrófono destapado, sin funda que lo cubra", "Una funda sobre el micrófono apaga los agudos y cambia el sonido de un teléfono a otro."]
                ]},
                { id: "entorno", nombre: "Entorno", items: [
                    ["Sin viento fuerte ni lluvia", "El viento sobre el micrófono produce un retumbo grave que se confunde con el motor."],
                    ["Sin música, voces ni otros motores cerca", "Nadie habla durante la toma. Si pasa un ruido fuerte, repite la toma o anótalo en la ficha."]
                ]},
                { id: "cierre", nombre: "Antes de dar por buena la sesión", items: [
                    ["Grabación de prueba revisada", 'Graba 5 s de la toma A y ábrelos en <a href="#analizador">Analiza un audio</a>: debe abrirse sin errores y mostrar WAV a 44.1 o 48 kHz.'],
                    ["Ficha de la grabación completa", "Vehículo, toma, posición, teléfono y estado de la etiqueta. Una falla solo cuenta como confirmada si dice quién la confirmó y cómo."]
                ]}
            ];

            var CIRC = 2 * Math.PI * 52;
            var total = 0;
            var checks = [];
            var porGrupo = {};

            function crear(tag, clase, html) {
                var el = document.createElement(tag);
                if (clase) el.className = clase;
                if (html != null) el.innerHTML = html;
                return el;
            }

            var mini = document.getElementById("pg-mini");

            GRUPOS.forEach(function (g) {
                var grupo = crear("section", "pg-grupo");
                grupo.setAttribute("aria-labelledby", "pg-g-" + g.id);
                var cab = crear("div", "pg-grupo-cab");
                cab.innerHTML = '<span class="pg-grupo-icono"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONOS[g.id] + '</svg></span>';
                var h = crear("h4"); h.id = "pg-g-" + g.id; h.textContent = g.nombre;
                var cuenta = crear("span", "pg-grupo-cuenta");
                cab.appendChild(h); cab.appendChild(cuenta);
                grupo.appendChild(cab);

                var ul = crear("ul", "pg-items");
                var propios = [];
                g.items.forEach(function (it, i) {
                    var id = "pg-" + g.id + "-" + i;
                    var li = crear("li", "pg-item");
                    var caja = crear("div", "pg-fila-caja");
                    var label = crear("label", "pg-fila");
                    var input = crear("input", "pg-check");
                    input.type = "checkbox"; input.id = id;
                    var texto = crear("span", "pg-texto"); texto.textContent = it[0];
                    label.appendChild(input); label.appendChild(texto);

                    var info = crear("button", "pg-info", '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>');
                    info.type = "button";
                    info.setAttribute("aria-expanded", "false");
                    info.setAttribute("aria-controls", id + "-porque");
                    info.setAttribute("aria-label", "Por qué: " + it[0]);

                    var porque = crear("div", "pg-porque");
                    porque.id = id + "-porque";
                    porque.setAttribute("inert", "");
                    var interior = crear("div");
                    interior.appendChild(crear("p", null, it[1]));
                    porque.appendChild(interior);

                    info.addEventListener("click", function () {
                        var abierto = li.classList.toggle("pg-abierto");
                        info.setAttribute("aria-expanded", abierto ? "true" : "false");
                        if (abierto) porque.removeAttribute("inert"); else porque.setAttribute("inert", "");
                    });
                    input.addEventListener("change", function () {
                        li.classList.toggle("pg-hecho", input.checked);
                        actualizar();
                    });

                    caja.appendChild(label); caja.appendChild(info);
                    li.appendChild(caja); li.appendChild(porque);
                    ul.appendChild(li);
                    checks.push(input); propios.push(input);
                    total++;
                });
                grupo.appendChild(ul);
                contenedor.appendChild(grupo);

                var fila = crear("li");
                fila.innerHTML = "<b></b><span></span><div class=\"pg-mini-barra\"><i></i></div>";
                fila.querySelector("b").textContent = g.id === "cierre" ? "Cierre" : g.nombre;
                mini.appendChild(fila);

                porGrupo[g.id] = { el: grupo, cuenta: cuenta, checks: propios, mini: fila };
            });

            var banda = crear("div", "pg-listo-banda", '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="8 12.5 11 15.5 16.5 9.5"/></svg><span><strong>Listo para grabar.</strong> Sigue con las tomas A, B y D; la C es opcional.</span>');
            contenedor.appendChild(banda);

            var panel = document.getElementById("pg-lista");
            var anillo = document.getElementById("pg-anillo-valor");
            var cuentaTotal = document.getElementById("pg-cuenta");
            var estado = document.getElementById("pg-estado");
            document.getElementById("pg-total").textContent = total;
            anillo.style.strokeDasharray = CIRC.toFixed(2);

            function actualizar() {
                var hechos = 0;
                Object.keys(porGrupo).forEach(function (k) {
                    var g = porGrupo[k];
                    var n = g.checks.filter(function (c) { return c.checked; }).length;
                    hechos += n;
                    var lleno = n === g.checks.length;
                    g.cuenta.textContent = n + "/" + g.checks.length;
                    g.el.classList.toggle("pg-lleno", lleno);
                    g.mini.classList.toggle("pg-lleno", lleno);
                    g.mini.querySelector("span").textContent = n + "/" + g.checks.length;
                    g.mini.querySelector("i").style.width = (100 * n / g.checks.length) + "%";
                });
                cuentaTotal.textContent = hechos;
                anillo.style.strokeDashoffset = (CIRC * (1 - hechos / total)).toFixed(2);
                var completo = hechos === total;
                panel.classList.toggle("pg-completo", completo);
                estado.classList.toggle("pg-listo", completo);
                var faltan = total - hechos;
                estado.textContent = completo ? "Todo listo para grabar." : (faltan === 1 ? "Falta 1 punto." : "Faltan " + faltan + " puntos.");
            }

            document.getElementById("pg-reiniciar").addEventListener("click", function () {
                checks.forEach(function (c) { c.checked = false; c.closest(".pg-item").classList.remove("pg-hecho"); });
                actualizar();
            });

            actualizar();
        })();
