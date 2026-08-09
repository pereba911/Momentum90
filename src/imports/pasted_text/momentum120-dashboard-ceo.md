Actúa como un arquitecto senior de software, desarrollador full-stack y diseñador de producto, con experiencia en dashboards financieros ejecutivos, apps SaaS, UX para personas con TDAH y sistemas de toma de decisiones bajo presión.
Tu tarea es diseñar y construir una aplicación web completa, funcional y lista para producción llamada:
App Name: Momentum120
Este sistema es un centro de control financiero y de ejecución personal enfocado en recuperación, estabilización y expansión financiera, con un ciclo claro de 120 días.

OBJETIVOS CLAVE DEL SISTEMA
La aplicación debe permitir que el usuario:
* Entienda su situación financiera en menos de 30 segundos
* Sepa en qué enfocarse HOY
* Visualice progreso real y motivante
* Tome decisiones rápidas bajo presión
* Mantenga constancia (especialmente pensado para TDAH)
* Tenga datos históricos y tendencias claras
* Escale posteriormente como SaaS multiusuario

CARACTERÍSTICAS GENERALES DE LA APLICACIÓN
La aplicación debe:
* Ser una web app responsiva (desktop + móvil)
* Tener persistencia total de datos
* Calcular todas las métricas automáticamente
* Requerir mínima entrada manual
* Tener modo claro y oscuro
* Diseño ejecutivo, limpio, minimalista pero visual
* Uso estratégico de:
    * emojis (termómetros, estatus, alertas)
    * iconos
    * colores semáforo
* Gamificación ligera y elegante
* Pensada para uso diario

STACK Y ARQUITECTURA (OBLIGATORIO)
Frontend
* Framework moderno reactivo (React / Next.js)
* Gráficas dinámicas (charts reactivos)
* UI orientada a dashboards ejecutivos
Backend y Datos
* Integración con Supabase (obligatorio):
    * Base de datos PostgreSQL
    * Autenticación
    * Persistencia de usuarios y registros
    * Históricos y timestamps
* Arquitectura preparada para:
    * multiusuario
    * escalamiento SaaS
    * futuras suscripciones
Funcionalidades Técnicas
* Autenticación básica (1 usuario inicialmente)
* Campos numéricos con formato:
    * MXN / USD / EUR (configurable)
* Lógica basada en fechas (día, semana, mes, trimestre)
* Datos NO se pierden entre sesiones
* Exportación:
    * CSV
    * PDF
* Resúmenes automáticos generados por sistema

ESTRUCTURA GENERAL DE LA APP
IMPORTANTE: La primera pantalla SIEMPRE debe ser el DASHBOARD PRINCIPAL, que consolida TODO. El usuario no debe navegar para entender su estado general.

TAB 1 – DASHBOARD CEO (PANTALLA PRINCIPAL)
Propósito
Mostrar toda la situación financiera, operativa y de enfoque diario en menos de 30 segundos.
Pensado para:
* personas con TDAH
* revisión diaria
* saber qué área necesita atención HOY

KPIs FINANCIEROS PRINCIPALES
Tarjetas visuales (KPI Cards):
* 💰 Efectivo disponible hoy
* ⏳ Dinero pendiente por cobrar
* 💳 Deuda total (tarjetas y pasivos)
* 🛟 Meses de colchón financiero Fórmula: Efectivo disponible / gasto mensual promedio Meta visual: 3 meses

META ECONÓMICA MENSUAL (NUEVO)
Sección visible en dashboard:
* Meta mensual de ingresos (manual)
* Ingresos cobrados del mes
* Monto faltante para meta
* Barra de progreso
* % de cumplimiento
Reglas:
* Se resetea automáticamente cada mes
* Solo ingresos cobrados impactan esta meta
* Cambio automático por calendario

CRM DE INGRESOS / ACTIVOS EN VENTA (NUEVO)
Resumen visual en dashboard (con link a tab completo):
* Artículos / propiedades / activos digitales
* Estados:
    * No publicado
    * Publicado
    * Interesados
    * Negociación
    * Vendido
* Ingreso potencial estimado
* % de impacto posible sobre la meta mensual
Objetivo:
Saber de dónde puede venir el dinero, no solo el dinero ya cobrado.

INGRESOS Y PIPELINE
* Ingresos cobrados este mes
* Ingresos proyectados 30 / 60 días
* Prospectos activos
* Propiedades / activos activos
* Referidos solicitados

CAPITAL Y PATRIMONIO
* Capital disponible para inversión / flipping
* Fondo de emergencia
* Fondo de viajes (ligado a objetivo)
* Patrimonio neto estimado

HÁBITOS Y CONSTANCIA (NUEVO EN DASHBOARD)
Gráfica visual de constancia:
* Gym
* Natación
* Dormir antes de medianoche
* Protocolo TDAH / ansiedad
* Contenido publicado
* Tareas clave completadas
Indicadores:
* % de cumplimiento semanal
* Tendencia visual
* Alertas suaves de áreas débiles

METAS ANUALES Y TRIMESTRALES (NUEVO)
Metas Anuales
* 10 a 20 metas personalizables
* Vista resumida diaria
* Estado visual (activo / en progreso / cumplido)
Metas Trimestrales
* Objetivos del trimestre
* Monto económico asociado
* Progreso acumulado

CONTEXTO TEMPORAL (NUEVO)
Indicador visible:
* Trimestre actual del año (Q1–Q4)
* Mes actual
* Semana del ciclo de 120 días

INDICADOR DE ESTRÉS FINANCIERO
* Escala manual 1–10
* Registro diario o semanal
* Gráfica de tendencia

SISTEMA DE SCORE CEO
Entrada semanal:
* 💰 Dinero
* 🧠 Salud
* 🎯 Enfoque
* 🤝 Relaciones
* 📈 Negocio
Cálculos:
* Promedio semanal
* Tendencia (↑ → ↓)

TAB 2 – MOTOR DE DINERO
INGRESOS
Campos:
* Fecha
* Tipo
* Descripción
* Monto
* Estado (prospecto → cobrado)
Cálculos:
* Pipeline total
* Pipeline 30 / 60 días
* Ingresos cobrados
* Ingresos pendientes

GASTOS
Campos por categoría + descripción
Cálculos:
* Gasto mensual
* Promedios
* Tendencias
* Distribución por categoría

DEUDAS
Campos:
* Nombre
* Saldo
* Pago mínimo
* Pago objetivo
* Fecha objetivo
Visuales:
* % liquidado
* Fecha estimada
* Barras de progreso

TAB 3 – CONTROL DE CAPITAL Y METAS
Módulos:
* Vehículo
* Fondo de emergencia
* Capital de inversión
Indicadores:
* Meta
* Acumulado
* Faltante
* % avance
MOTOR DE ASIGNACIÓN INTELIGENTE
* Sugerencias automáticas al ingresar ingresos
* Ajuste manual permitido
* Historial guardado

TAB 4 – PLAN 120 DÍAS
Fases:
1. Estabilización
2. Recuperación
3. Expansión
Por semana:
* Objetivo
* Meta monetaria
* Resultado real
* Aprendizajes

TAB 5 – TAREAS Y EJECUCIÓN (NUEVO)
* Ingreso manual de tareas
* Tareas tachadas permanecen visibles
* Eliminación automática después de 1 mes
* Indicador diario:
    * ✅ 3 tareas clave completadas

AUTOMATIZACIONES
* Dashboard se actualiza solo
* Resúmenes:
    * Semanales
    * Mensuales
* Recomendaciones automáticas de enfoque
* Exportaciones CSV / PDF
* Preparado para SaaS

FILOSOFÍA DE DISEÑO
* Ejecutivo
* Calma
* Claridad
* Visual
* Motivacional
* Gamificación ligera
* Ideal para TDAH
* Decisiones rápidas

ENTREGABLE FINAL
Una aplicación web funcional, con persistencia real vía Supabase, que actúe como un centro de control financiero y de ejecución personal, optimizado para un ciclo de 120 días, listo para evolucionar a SaaS.

==================================================
DIRECCIÓN DE ARTE Y LOOK & FEEL (Inspiración de Imagen Adjunta):

1. MODO OSCURO PREMIUM (Paleta de Colores):
   - Fondo principal: Usa un color negro puro o gris extremadamente oscuro (ej. `bg-[#0B0B0E]` o `bg-[#0D0D12]`).
   - Contenedores/Tarjetas: Usa un gris oscuro translúcido o sólido con muy buen contraste (ej. `bg-[#16161F]` o `bg-[#1C1C24]`).
   - Tonos de Acento: Implementa los colores vibrantes de la imagen para elementos clave:
     * Morado neón para botones principales y selección activa: `bg-[#7B2CBF]` o `bg-[#9D4EDD]`.
     * Azul eléctrico y rosa/naranja brillante solo para gráficos, tarjetas de crédito o estados específicos.

2. TRATAMIENTO DE CONTENEDORES Y BORDES:
   - Aplica esquinas muy redondeadas en todas las tarjetas y modales utilizando `rounded-2xl` o `rounded-3xl` para emular el aspecto móvil/premium.
   - Las tarjetas internas deben tener un borde ultrafino de 1px casi imperceptible para separarlas del fondo (ej. `border border-gray-800/40` o `border-white/5`).
   - Evita sombras pesadas; en su lugar, usa un brillo sutil o un diseño completamente plano (flat) sobre capas oscuras.

3. TIPOGRAFÍA Y TEXTOS:
   - Usa una fuente Sans-Serif limpia, moderna y geométrica (tipo Geist o Inter).
   - Los números de balances económicos principales deben ser grandes, en negrita (`font-bold` o `font-extrabold`) y de color blanco puro (`text-white`).
   - Los textos secundarios, fechas e historial deben usar un gris atenuado (`text-gray-400` o `text-gray-500`) para generar una jerarquía visual clara.

4. DETALLES DE INTERFAZ (UI):
   - Iconos: Usa iconos lineales y minimalistas (estilo Lucide React), encerrados en círculos oscuros con fondo grisáceo suave si están en menús.
   - Barra de navegación inferior/lateral: Fondo oscuro semi-transparente con efecto de desenfoque (`backdrop-blur-md bg-[#16161F]/80`) y resalta el icono activo con el color morado neón.
==================================================