# STREAMING GAMAZ — Cloudflare Pages

Adaptación de este proyecto para conservar la consulta directa, sin usuarios ni
panel de administración. El HTML, CSS, logo y fondo se mantienen idénticos al ZIP
original. El navegador consulta /api/getLastEmail en lugar de la ruta de Netlify.

## 1. Subir a GitHub

Descomprime el ZIP y sube el CONTENIDO de streaminggamaz-main a la raíz del repositorio
que vayas a conectar a Cloudflare (por ejemplo virtualformacion/streaminggamaz).
No subas el ZIP ni una carpeta adicional encima del contenido.

Reemplaza los archivos anteriores y elimina del repositorio, si existen:
- node_modules/
- netlify/
- netlify.toml
- package-lock.json del proyecto antiguo

Deben quedar en la raíz functions/, lib/, package.json y build.mjs junto a la
página y sus imágenes. No subas archivos .env ni claves reales.

## 2. Crear el proyecto de Pages

En Cloudflare entra en Workers & Pages, crea una aplicación y elige Pages.
Si ves una pantalla de Workers, pulsa Continue to Pages.
Elige Import an existing Git repository y conecta tu repositorio de GitHub.
No utilices la carga de archivos por arrastrar y soltar para esta estructura.

| Configuración | Valor |
|---|---|
| Production branch | main |
| Framework preset | None / ninguno |
| Build command | npm run build |
| Build output directory | dist |
| Root directory | Vacío: raíz del repositorio |

No necesitas comando de despliegue wrangler, D1 ni flags de Node.js.
Cloudflare compila functions/ desde la raíz; el build copia los archivos públicos
a dist. No muevas functions ni lib dentro de dist.

## 3. Variables de producción

En el proyecto Pages abre Settings > Variables and Secrets > Add.
Selecciona Production si aparece un selector de entorno. Añade una por una:

| Nombre exacto | Valor | Tipo |
|---|---|---|
| GMAIL_CLIENT_ID | Client ID que utilizabas en Netlify para esta cuenta | Texto |
| GMAIL_CLIENT_SECRET | Client Secret de ese cliente OAuth | Secreto / Encrypt |
| GMAIL_REFRESH_TOKEN | Refresh Token correspondiente a esa cuenta y cliente | Secreto / Encrypt |

Introduce el nombre y el valor en campos separados, sin signo = ni comillas.
No necesitas GITHUB_TOKEN, GITHUB_REPO, GITHUB_FILE_PATH, GITHUB_BRANCH ni variables
de administrador. La conexión de Cloudflare con GitHub se autoriza en el panel;
esta página no modifica archivos del repositorio.

Después de guardar las variables vuelve a desplegar. Si ya hubo un despliegue,
ve a Deployments y reintenta el último de main. Espera a que termine correctamente.

## 4. Prueba final en tu cuenta

Abre la URL pages.dev de producción e introduce el correo que quieres consultar.
Debe haber un correo que coincida con los asuntos originales, dirigido a ese
correo, recibido dentro de los últimos 10 minutos y entre los últimos 10 mensajes
del buzón. Comprueba la visualización del código y las redirecciones de enlaces.

Si Google no puede renovar el acceso, revisa las tres variables como un conjunto:
deben corresponder entre sí y mantener permisos para leer Gmail.
Si aparece Falta GMAIL_..., revisa el entorno Production y vuelve a desplegar.
Si /api/getLastEmail devuelve una página HTML, revisa que estés usando Pages con
integración Git y que functions/ esté en la raíz del repositorio.

## Qué se conserva y qué cambia

Se conservan de la función original de STREAMING GAMAZ:
- maxResults: 10, sin añadir filtros nuevos de Gmail.
- Todos sus asuntos, incluidos Netflix: Tu código de inicio de sesión y Este código vence en 15 minutos.
- Los dos recorridos y la prioridad original de código sobre enlace.
- La comprobación del destinatario y de la fecha: ventana original de 10 minutos.
- Los tres tipos de enlace Netflix, su prioridad y las funciones de extracción.
- La consulta directa y el diseño, sin inicio de sesión ni administración.

Cambios para ejecutar en Cloudflare:
- Entrada onRequest y variables obtenidas de env.
- Transporte REST con OAuth refresh, en lugar de googleapis/dotenv.
- Lectura por lotes de hasta 20 mensajes y reutilización en el segundo recorrido,
  para reducir las peticiones HTTP externas. No altera el orden de selección.
- Base64URL con soporte para - y _, relleno opcional y texto UTF-8.
- Se quita la pausa aleatoria artificial de 1 a 7 segundos y los logs de cuerpos de
  correo. Los resultados siguen las reglas originales.
- El navegador muestra el mensaje de error del servidor cuando existe.

Se conservan las limitaciones de extracción del original: no se añadieron nuevos
asuntos ni reglas para otras estructuras de correo. La página continúa siendo una
consulta directa pública, según el funcionamiento solicitado.

## Validación

npm test compara esta función con la original para cada asunto y cada tipo de
enlace, además de correos vencidos, destinatarios distintos, Unicode/Base64URL,
prioridad de código frente a enlace, resultados hasta la posición 10 y errores
internos de los lotes. npm run build prepara los archivos públicos.

Estas pruebas utilizan respuestas simuladas: no se enviaron consultas a tu Gmail
ni se modificó GitHub. La compilación con Wrangler verifica el empaquetado de las
funciones, pero la conexión real con Google requiere la prueba en tu cuenta.

Documentación oficial:
https://developers.cloudflare.com/pages/functions/get-started/
https://developers.cloudflare.com/pages/functions/bindings/
https://developers.cloudflare.com/pages/configuration/build-configuration/
