(function setupContactForm() {
  const form = document.getElementById("contact-form");
  const submitButton = document.getElementById("contact-submit");
  const feedback = document.getElementById("contact-feedback");
  if (!form || !submitButton || !feedback) return;

  function setFeedback(message, isError, isSuccess) {
    feedback.textContent = message || "";
    feedback.classList.toggle("is-error", !!isError);
    feedback.classList.toggle("is-success", !!isSuccess);
  }

  function getTargets(hasAttachment) {
    const sameOrigin = "/api/contact";
    const localTargets = [
      "http://localhost:3000/api/contact",
      "http://127.0.0.1:3000/api/contact",
      "http://localhost:3001/api/contact",
      "http://127.0.0.1:3001/api/contact"
    ];
    const formSubmit = "https://formsubmit.co/ajax/contact@multipixels.fr";
    const backend = [sameOrigin].concat(localTargets).map(function (url) {
      return { kind: "backend", url: url };
    });
    return hasAttachment ? backend : backend.concat([{ kind: "formsubmit", url: formSubmit }]);
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const raw = String(reader.result || "");
        const commaIndex = raw.indexOf(",");
        resolve(commaIndex >= 0 ? raw.slice(commaIndex + 1) : raw);
      };
      reader.onerror = function () { reject(new Error("Impossible de lire le fichier joint.")); };
      reader.readAsDataURL(file);
    });
  }

  function buildTargetPayload(target, payload) {
    if (target.kind === "formsubmit") {
      const formData = new FormData();
      formData.append("nom", payload.nom);
      formData.append("email", payload.email);
      formData.append("tel", payload.tel);
      formData.append("service", payload.service);
      formData.append("quantite", payload.quantite);
      formData.append("website", payload.website);
      formData.append("message", payload.message);
      formData.append("_subject", "Nouvelle demande - " + payload.service);
      formData.append("_captcha", "false");
      formData.append("_replyto", payload.email);
      return formData;
    }

    return {
      nom: payload.nom,
      email: payload.email,
      tel: payload.tel,
      service: payload.service,
      quantite: payload.quantite,
      website: payload.website,
      message: payload.message,
      attachment: payload.attachment
    };
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    submitButton.disabled = true;
    submitButton.textContent = "Envoi en cours...";
    setFeedback("Préparation de votre demande...", false, false);

    try {
      const attachmentFile = form.piece_jointe && form.piece_jointe.files && form.piece_jointe.files[0] ? form.piece_jointe.files[0] : null;
      const payload = {
        nom: (form.nom.value || "").trim(),
        email: (form.email.value || "").trim(),
        tel: (form.tel.value || "").trim(),
        service: (form.service.value || "devis").trim(),
        quantite: (form.quantite.value || "").trim(),
        website: (form.website.value || "").trim(),
        message: (form.message.value || "").trim(),
        attachment: null
      };

      if (payload.website) {
        form.reset();
        setFeedback("Merci, votre demande a bien été transmise.", false, true);
        return;
      }

      if (!payload.nom || !payload.email || !payload.tel || !payload.message) {
        throw new Error("Merci de compléter les champs nom, email, téléphone et message.");
      }

      if (attachmentFile) {
        if (attachmentFile.size > 8 * 1024 * 1024) {
          throw new Error("Le fichier joint dépasse la limite de 8 Mo.");
        }
        payload.attachment = {
          filename: attachmentFile.name,
          contentType: attachmentFile.type || "application/octet-stream",
          size: attachmentFile.size,
          contentBase64: await readFileAsBase64(attachmentFile)
        };
      }

      const targets = getTargets(!!attachmentFile);
      let sent = false;
      for (const target of targets) {
        try {
          const targetPayload = buildTargetPayload(target, payload);
          const headers = target.kind === "formsubmit"
            ? { "Accept": "application/json" }
            : { "Content-Type": "application/json", "Accept": "application/json" };
          const response = await fetch(target.url, {
            method: "POST",
            headers: headers,
            body: target.kind === "formsubmit" ? targetPayload : JSON.stringify(targetPayload)
          });
          const contentType = String(response.headers.get("content-type") || "").toLowerCase();
          const body = contentType.includes("application/json") ? await response.json() : null;
          const ok = target.kind === "formsubmit"
            ? response.ok && (!body || body.success === true || body.success === "true" || body.ok === true)
            : response.ok && !!(body && body.ok);
          if (!ok) {
            throw new Error(body && body.error && body.error.message ? body.error.message : "Service d'envoi indisponible.");
          }
          sent = true;
          break;
        } catch (_) {
        }
      }

      if (!sent) {
        throw new Error(attachmentFile
          ? "Le formulaire avec pièce jointe nécessite l'API contact active côté serveur."
          : "Le service d'envoi est temporairement indisponible.");
      }

      form.reset();
      setFeedback("Votre demande a bien été envoyée. Réponse estimée sous 24 à 48h.", false, true);
    } catch (error) {
      setFeedback(error && error.message ? error.message : "Impossible d'envoyer la demande pour le moment.", true, false);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Envoyer la demande";
    }
  });
})();
