import {decode64, jsonResponse} from '../../lib/encoding.js';

// REST transport for Cloudflare. The selection logic below is from the original
// Netlify function: same 10 messages, subjects, dates, priority and link rules.
async function gmailClient(env) {
  for (const key of ['GMAIL_CLIENT_ID','GMAIL_CLIENT_SECRET','GMAIL_REFRESH_TOKEN']) {
    if (!env[key]) throw new Error(`Falta ${key} en Cloudflare`);
  }
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', body:new URLSearchParams({
      client_id:env.GMAIL_CLIENT_ID, client_secret:env.GMAIL_CLIENT_SECRET,
      refresh_token:env.GMAIL_REFRESH_TOKEN, grant_type:'refresh_token'
    })
  });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || !token.access_token) throw new Error('Google no pudo renovar el acceso a Gmail. Revisa las credenciales y permisos.');
  const auth = {Authorization:`Bearer ${token.access_token}`};
  let listed=[];
  const cache=new Map();
  async function loadBatch(start) {
    const group=listed.slice(start,start+20);
    const boundary='going_merry_request';
    const parts=group.map((msg,i)=>`--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <m${i}>\r\n\r\nGET /gmail/v1/users/me/messages/${encodeURIComponent(msg.id)}?format=full HTTP/1.1\r\n\r\n`).join('');
    const res=await fetch('https://gmail.googleapis.com/batch/gmail/v1', {
      method:'POST', headers:{...auth,'Content-Type':`multipart/mixed; boundary=${boundary}`},
      body:parts+`--${boundary}--\r\n`
    });
    if (!res.ok) throw new Error(`Gmail respondió ${res.status}`);
    const type=res.headers.get('Content-Type')||'';
    const responseBoundary=/boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(type);
    if (!responseBoundary) throw new Error('Respuesta por lotes de Gmail inválida');
    const text=await res.text();
    const received=new Set();
    for (const part of text.split('--'+(responseBoundary[1]||responseBoundary[2])).slice(1)) {
      const id=/Content-ID:\s*<response-m(\d+)>/i.exec(part);
      if(!id) continue;
      const index=Number(id[1]);
      if(!group[index]) throw new Error('Identificador de respuesta Gmail inválido');
      const status=/HTTP\/1\.[01]\s+(\d+)/.exec(part);
      const jsonStart=part.indexOf('{');
      const jsonEnd=part.lastIndexOf('}');
      if(!status || jsonStart<0) throw new Error('Respuesta de mensaje Gmail inválida');
      const data=JSON.parse(part.slice(jsonStart,jsonEnd+1));
      received.add(index);
      cache.set(group[index].id, Number(status[1])===200
        ? {data} : {error:`Gmail respondió ${status[1]}`} );
    }
    if(received.size!==group.length) throw new Error('Gmail devolvió un lote incompleto');
  }
  return {users:{messages:{
    async list({maxResults}) {
      const res=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`,{headers:auth});
      if(!res.ok) throw new Error(`Gmail respondió ${res.status}`);
      const data=await res.json(); listed=data.messages||[]; return {data};
    },
    async get({id}) {
      if(!cache.has(id)) {
        const index=listed.findIndex(msg=>msg.id===id);
        if(index<0) throw new Error('Mensaje no encontrado');
        await loadBatch(Math.floor(index/20)*20);
      }
      const result=cache.get(id);
      if(result.error) throw new Error(result.error);
      return result;
    }
  }}};
}

export async function onRequest({request,env}) {
  if(request.method!=='POST')return jsonResponse({error:'Use POST'},405);
  const result=await handler({body:await request.text()},env);
  return jsonResponse(JSON.parse(result.body),result.statusCode);
}

async function handler(event, env) {
  try {
    const { email } = JSON.parse(event.body);

    if (typeof email !== 'string' || !email.trim()) {
      return {statusCode:400,body:JSON.stringify({error:'Introduce un correo'})};
    }
    const gmail = await gmailClient(env);

    const response = await gmail.users.messages.list({
      userId: "me",
      maxResults: 10, // Buscar hasta 10 correos
    });


    if (!response.data.messages) {
      return { statusCode: 404, body: JSON.stringify({ message: "No hay mensajes recientes" }) };
    }

    // ------------ Lógica de Disney+ -----------------
    const disneySubjects = [
      "amazon.com: Sign-in attempt",
      "amazon.com: Intento de inicio de sesión",
      "Netflix: Tu código de inicio de sesión",
      "Este código vence en 15 minutos",
      "Tu código de acceso único para Disney+" // Asunto específico de Disney+
    ];

    const disneyLinks = [
      "https://www.disneyplus.com/codigo" // Enlace que podría ser válido para Disney+
    ];

    // Procesar los mensajes de Disney+
    for (let msg of response.data.messages) {
      const message = await gmail.users.messages.get({ userId: "me", id: msg.id });
      const headers = message.data.payload.headers;
      const toHeader = headers.find(h => h.name === "To");
      const subjectHeader = headers.find(h => h.name === "Subject");
      const dateHeader = headers.find(h => h.name === "Date");
      const timestamp = new Date(dateHeader.value).getTime();
      const now = new Date().getTime();


      // Verificar si es un correo con asunto de Disney+ y reciente
      if (
        toHeader &&
        toHeader.value.toLowerCase().includes(email.toLowerCase()) &&
        disneySubjects.some(subject => subjectHeader.value.includes(subject)) &&
        (now - timestamp) <= 10 * 60 * 1000 // 10 minutos de diferencia
      ) {
        const body = getDisneyPlusMessageBody(message.data); // Usamos solo para Disney+

        // Retornar el cuerpo del mensaje de Disney+ para mostrarlo en el frontend
        return { statusCode: 200, body: JSON.stringify({ alert: "Código de Disney+ encontrado", body }) };
      }
    }

    // ------------ Lógica de Netflix -----------------
    const validSubjects = [
      "Importante: Cómo actualizar tu Hogar con Netflix",
      "Importante: Cómo cambiar tu Hogar con Netflix",
      "Tu código de acceso temporal de Netflix", 
      "Tu código de acceso temporal de Netflix",
      "Completa tu solicitud de cambio de contraseña",
      "Completa tu solicitud de restablecimiento de contraseña"
    ];

    const validLinks = [
      "https://www.netflix.com/account/travel/verify?nftoken=",
      "https://www.netflix.com/password?g=",
      "https://www.netflix.com/account/update-primary-location?nftoken="
    ];

  
    for (let msg of response.data.messages) {
      const message = await gmail.users.messages.get({ userId: "me", id: msg.id });
      const headers = message.data.payload.headers;
      const toHeader = headers.find(h => h.name === "To");
      const subjectHeader = headers.find(h => h.name === "Subject");
      const dateHeader = headers.find(h => h.name === "Date");
      const timestamp = new Date(dateHeader.value).getTime();
      const now = new Date().getTime();


      if (
        toHeader &&
        toHeader.value.toLowerCase().includes(email.toLowerCase()) &&
        validSubjects.some(subject => subjectHeader.value.includes(subject)) &&
        (now - timestamp) <= 10 * 60 * 1000 // 10 minutos de diferencia
      ) {
        const body = getNetflixMessageBody(message.data); // Usamos solo para Netflix
        const link = extractLink(body, validLinks);
        if (link) {
          return { statusCode: 200, body: JSON.stringify({ link: link.replace(/\]$/, "") }) };
        }
      }
    }

    return { statusCode: 404, body: JSON.stringify({ message: "No se encontró un resultado para tu cuenta, vuelve a intentar nuevamente" }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

// Función específica para Disney+
function getDisneyPlusMessageBody(message) {
  if (message.payload.parts) {
    for (let part of message.payload.parts) {
      if (part.mimeType === "text/html" && part.body.data) {
        return decode64(part.body.data);
      }
    }
  }
  
  if (message.payload.body.data) {
    return decode64(message.payload.body.data);
  }

  return message.snippet || "";
}

// Función específica para Netflix
function getNetflixMessageBody(message) {
  if (!message.payload.parts) {
    return message.snippet || "";
  }
  
  for (let part of message.payload.parts) {
    if (part.mimeType === "text/plain" && part.body.data) {
      return decode64(part.body.data);
    }
  }
  return "";
}

function extractLink(text, validLinks) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);
  if (matches) {

    const preferredLinks = [
      "https://www.netflix.com/account/travel/verify?nftoken=",
      "https://www.netflix.com/account/update-primary-location?nftoken="
    ];

    const validLink = matches.find(url =>
      preferredLinks.some(valid => url.includes(valid))
    );

    if (validLink) {
      return validLink.replace(/\]$/, "");
    }

    const fallbackLink = matches.find(url => url.includes("https://www.netflix.com/password?g="));

    if (fallbackLink) {
      return fallbackLink.replace(/\]$/, "");
    }
  }
  return null;
}
