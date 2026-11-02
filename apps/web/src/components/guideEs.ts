import type { GuideSection } from './guideContent';

/** Guía de uso en español. Las capturas viven en /guide/<shot>. */
export const GUIDE_ES: GuideSection[] = [
  {
    id: 'stage',
    title: '0 · Ajustes del escenario',
    intro:
      'Antes de cada pieza, deja el escenario listo. Se hace una vez al crearla y después vive en «Ajustes del escenario».',
    features: [
      {
        title: 'Nueva coreografía',
        body: [
          'Pulsa Biblioteca, arriba a la izquierda, y luego Nueva coreografía.',
          'Escribe un título, elige un tamaño (escenario a la italiana 12×8, aula, caja negra, gimnasio o personalizado) y pulsa Crear.',
        ],
      },
      {
        title: 'Diálogo de ajustes',
        body: [
          'Abre Ajustes del escenario para cambiar el ancho, la profundidad, el lado de la audiencia, los laterales y la foto de fondo.',
          'Ahí también puedes añadir rectángulos con etiqueta y textos fijos: un mueble o un letrero que no se mueve entre formaciones.',
          'Puedes volver a cambiarlos cuando quieras, sin crear la pieza de nuevo.',
        ],
        shot: 's0-stage-settings.png',
      },
      {
        title: 'Lado de la audiencia',
        body: [
          'Abajo es la vista del director. Arriba es la vista de quien está en el escenario: el plano gira 180°.',
          'Solo cambia cómo se mira. Las coordenadas guardadas no se mueven.',
        ],
      },
      {
        title: 'Laterales',
        body: [
          'Al fijar el ancho de la izquierda, la derecha y el fondo, los bailarines pueden esperar fuera del escenario antes de entrar.',
        ],
      },
      {
        title: 'Foto de fondo',
        body: [
          'Sube una foto del local bajo la rejilla y ajusta su opacidad para comparar con el escenario real.',
        ],
      },
    ],
  },
  {
    id: 'workspace',
    title: '1 · El espacio de trabajo',
    intro: 'Cuatro zonas. Cuando las reconoces, el resto no se pierde.',
    features: [
      {
        title: 'Distribución',
        body: [
          'Arriba: barra (título, Biblioteca, compartir, exportar, ⚙).',
          'Izquierda: elenco. Centro: el escenario. Derecha: propiedades. Abajo: la línea de tiempo.',
        ],
        shot: 's1-workspace.png',
      },
      {
        title: 'Modo básico y completo',
        body: [
          'Se cambia en Preferencias (⚙).',
          'El básico deja lo esencial. El completo abre equipos, utilería, desenredar, preajustes y el resto.',
        ],
        tip: 'La primera vez, básico. Cuando ya te mueves, completo.',
      },
      {
        title: 'Herramientas del lienzo',
        body: [
          'Arriba a la derecha del escenario: Ajustar (rejilla), Lápiz, Nota y el cambio a 3D.',
        ],
      },
      {
        title: 'Deshacer y rehacer',
        body: ['Botones Deshacer y Rehacer, o Ctrl+Z y Ctrl+Mayús+Z.'],
      },
    ],
  },
  {
    id: 'music',
    title: '2 · Música y formaciones',
    intro: 'Importa la música para que los desplazamientos sigan el pulso.',
    demo: 'Demo · Paths & Facing',
    features: [
      {
        title: 'Importar audio',
        body: ['En la línea de tiempo, Subir audio. Al cargarse aparece la forma de onda.'],
      },
      {
        title: 'BPM y tempo',
        body: [
          'En Pulsos… escribe los pulsos por minuto.',
          'Si no lo sabes, Calibrar BPM: toca al ritmo y el tempo se calcula solo.',
        ],
      },
      {
        title: 'Marcadores y tramos de cuenta',
        body: [
          'Marca pulsos y delimita los tramos que se cuentan en ochos.',
          'La música casi nunca entra en la cuenta 1. Cada tramo alinea su propia cuenta 1.',
        ],
      },
      {
        title: 'Metrónomo',
        body: ['Con Clic activo, la reproducción marca cada pulso. La cuenta 1 va acentuada.'],
      },
      {
        title: 'Formaciones y línea de tiempo',
        body: [
          'Cada bloque de la línea de tiempo es una formación.',
          'Arrástralo para cambiar cuándo entra. Reproducir muestra el desplazamiento.',
        ],
      },
      {
        title: 'Ensayo en bucle',
        body: [
          'Bucle dibuja un tramo azul con dos postes. La reproducción se repite dentro.',
          'Arrastra los postes. Cerca del borde de una formación se ajustan solos.',
        ],
        tip: 'Para una transición, encuadra desde el final de la formación anterior hasta el final de esta.',
      },
    ],
  },
  {
    id: 'solo',
    title: '3 · Una persona',
    intro: 'Elige a un bailarín y fija su sitio, su orientación y su recorrido.',
    demo: 'Demo · Paths & Facing',
    features: [
      {
        title: 'Selección y propiedades',
        body: [
          'Pulsa al bailarín en el escenario: a la derecha aparecen sus datos.',
          'Puedes cambiar x/y, el nombre, el color, el rol y el distintivo (unas letras dentro de la marca).',
        ],
      },
      {
        title: 'Orientación',
        body: [
          '0° mira a la audiencia. Los grados positivos giran en sentido horario.',
          'En el ejemplo, las tres formaciones miran distinto: la misma persona gira entre tramos.',
        ],
        shot: 's3-curve-path.png',
      },
      {
        title: 'Recta o curva',
        body: [
          'Cada formación elige cómo se llega a la siguiente: lineal o curva.',
          'La curva pasa por un tirador. En el ejemplo, de la 1 a la 2 es recta y de la 2 a la 3 es curva.',
        ],
      },
      {
        title: 'Recorrido de toda la pieza',
        body: [
          '«Mostrar el recorrido de toda la pieza» dibuja las paradas numeradas y las piernas en línea discontinua.',
        ],
      },
      {
        title: 'Marca de estado',
        body: [
          'En propiedades, Marca de estado pone un cuadrado, un triángulo o un rombo alrededor del bailarín.',
          'La marca es solo de esta formación: arrodillado en la tercera, con un objeto en la cuarta. El significado lo acuerda el equipo.',
        ],
        tip: 'Al reproducir, la marca se oculta: a mitad de la transición el estado no está definido.',
      },
    ],
  },
  {
    id: 'ensemble',
    title: '4 · Varias personas',
    intro: 'Con más gente, las plantillas y los grupos arman la formación rápido.',
    demo: 'Demo · Five Dancers',
    features: [
      {
        title: 'Plantillas',
        body: ['Un clic coloca una línea, una V, un círculo o una cuadrícula.'],
        shot: 's4-formation.png',
      },
      {
        title: 'Preajustes',
        body: ['Guarda la formación actual y aplícala a otra sin volver a colocar a nadie.'],
      },
      {
        title: 'Grupos y equipos',
        body: [
          'Etiqueta a los bailarines y selecciona el grupo entero (por ejemplo «primera fila» o «flyers»).',
          'Un equipo guarda el elenco completo para reutilizarlo en otra pieza.',
        ],
      },
      {
        title: 'Alinear, repartir, espejo, intercambiar',
        body: [
          'Alinea una fila, reparte el espacio, voltea toda la formación o cambia de sitio a dos personas.',
        ],
      },
      {
        title: 'Girar, abrir y cerrar el grupo',
        body: [
          'Con varios seleccionados, el grupo gira 15° alrededor de su centro. La orientación gira con ellos.',
          'Abrir agranda el espacio y Cerrar lo reduce, sin cambiar la forma.',
        ],
      },
      {
        title: 'Marco, arrastre y desenredar',
        body: [
          'Arrastra en el suelo vacío para encuadrar a varios y moverlos juntos.',
          'Desenredar cambia quién va a cada sitio para que los recorridos no se crucen y la distancia sea mínima.',
        ],
      },
      {
        title: 'Sugerencias',
        body: [
          'La app propone formas según cuánta gente hay, con una miniatura. Un clic las aplica.',
        ],
      },
    ],
  },
  {
    id: 'view',
    title: '5 · Cómo se mira (2D y 3D)',
    intro: 'Revisa el desplazamiento desde más de un punto de vista.',
    demo: 'Demo · Five Dancers',
    features: [
      {
        title: 'Vista de la audiencia',
        body: ['En 2D se alterna la vista del director y la de quien está en el escenario.'],
      },
      {
        title: 'Vista 3D',
        body: ['3D muestra el espacio, las distancias y la altura relativa.'],
        shot: 's5-3d.png',
      },
      {
        title: 'Cámaras y seguimiento',
        body: ['Audiencia, cenital o lateral. También puedes seguir a un bailarín.'],
      },
      {
        title: 'Análisis de la transición',
        body: [
          'La app avisa si dos personas casi chocan o si alguien tiene que ir demasiado rápido.',
          'El tramo curvo del ejemplo puede disparar un aviso, para ver cómo se ve.',
        ],
      },
      {
        title: 'Vídeo de referencia',
        body: [
          'El botón de vídeo de referencia carga un videoclip, un concurso o un ensayo en la misma línea de tiempo: reproducir y el cabezal mueven los dos a la vez.',
          'La música del proyecto se calla y suena el vídeo. Puedes usar una ventana flotante o una división a media pantalla.',
          'Para alinear: pausa el vídeo en un pulso claro, lleva el cabezal a ese pulso y pulsa Alinear aquí.',
        ],
        tip: 'El vídeo no se guarda. Al recargar hay que elegirlo otra vez. Si no se ve, usa MP4 (H.264).',
      },
      {
        title: 'Capturar una formación (borrador)',
        body: [
          'Calibrar: arrastra las cuatro chinchetas a las esquinas del escenario en el vídeo. La rejilla verde en metros tiene que coincidir con el suelo.',
          'Pausa en la formación que quieres y pulsa Capturar formación. Las personas detectadas pasan a coordenadas del escenario.',
          'La identidad se asigna por cercanía a la posición anterior. Las dudosas quedan seleccionadas para que confirmes quién es quién.',
        ],
        tip: 'Es un borrador. Quien esté tapado hay que colocarlo a mano. Funciona mejor con la cámara fija y un poco elevada. La primera vez se descarga un modelo de unos 4 MB.',
      },
      {
        title: 'Revisión del ensayo',
        body: [
          'Escanear todo el vídeo mira cada segundo y reconstruye la carta con las formaciones que se sostienen. Antes de sustituir, pide confirmación. Un Deshacer devuelve la carta anterior.',
          'La ventana del vídeo se arrastra por la barra y se redimensiona por la esquina. En modo dividido, el separador también se arrastra.',
          'Revisar compara el fotograma en pausa con la carta del cabezal: desvío de cada persona, si el puesto central está centrado y la simetría izquierda-derecha.',
          'Para revisar el puesto central, selecciona antes a ese bailarín.',
        ],
        tip: 'Después del ensayo, Revisar tramo a tramo deja la lista de notas hecha.',
      },
    ],
  },
  {
    id: 'export',
    title: '6 · Vídeo y archivos',
    intro: 'Saca un vídeo o un PDF para el equipo.',
    features: [
      {
        title: 'Animación (MP4)',
        body: ['Exporta el desplazamiento en 2D o en 3D, con la música mezclada.'],
        shot: 's6-export.png',
      },
      {
        title: 'PDF de cartas y elenco',
        body: ['Una carta por formación más la lista de quienes actúan.'],
      },
      {
        title: 'Hojas personales y paquete de ensayo',
        body: [
          'Una página por bailarín con su ruta.',
          'El paquete de ensayo junta las cartas y todas las hojas en un solo PDF.',
        ],
      },
      {
        title: 'PNG',
        body: ['La formación seleccionada, en una sola imagen.'],
      },
      {
        title: 'Archivo .gridstage y copia de seguridad',
        body: [
          'Exportar → Archivo guarda la coreografía en un .gridstage para enviarlo o guardarlo.',
          'Biblioteca → Importar lo trae de vuelta como una pieza nueva, sin pisar la que ya tienes. El .gridstage.json antiguo también entra.',
          'En el escritorio, un doble clic abre el archivo en GridStage. En Android, comparte el archivo recibido con GridStage. En la exportación también está Compartir…',
          'El trabajo vive en el navegador. Si borras los datos, se pierde. Cuando hay bastante contenido, la app recuerda cada semana que exportes una copia.',
        ],
        tip: 'El audio y la imagen de fondo no van en el archivo. Hay que subirlos otra vez.',
      },
    ],
  },
  {
    id: 'mobile',
    title: '7 · Teléfono y tableta',
    intro:
      'No hace falta una tienda de aplicaciones. Abre la página en el navegador y añádela a la pantalla de inicio.',
    features: [
      {
        title: 'Instalar en el teléfono',
        body: [
          'Abre https://changshenghsun.github.io/GridStage/ en el navegador del teléfono.',
          'Android (Chrome): menú ⋮ → Añadir a la pantalla de inicio → Instalar.',
          'iOS (Safari): Compartir → Añadir a la pantalla de inicio.',
          'Desde el icono se abre a pantalla completa y, tras la primera visita, funciona sin red.',
        ],
      },
      {
        title: 'Uso en el teléfono',
        body: [
          'En una pantalla estrecha, los paneles se esconden tras las pestañas Elenco y Utilería. Un toque las saca; un toque en la zona oscura las guarda.',
          'Los botones y los campos crecen al tacto. Arrastra a los bailarines con el dedo y toca la línea de tiempo.',
          'La pieza se guarda en el navegador de ese aparato. Para llevártela, Exportar → Archivo.',
        ],
        tip: 'Una tableta en horizontal, si es bastante ancha, muestra las tres columnas.',
      },
    ],
  },
];
