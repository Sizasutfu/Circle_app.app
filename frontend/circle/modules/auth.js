// ── Auth View ───────────────────────────────────────────────────────────────
// Form wiring, password toggle, country dial codes.
// Delegates login/register/OTP logic to modules/auth.js.

      /* ── COUNTRY DIAL CODES — all ITU-T E.164 countries ─────────── */
      const DIAL_COUNTRIES = [
        ["+93","🇦🇫","Afghanistan"],["+355","🇦🇱","Albania"],["+213","🇩🇿","Algeria"],
        ["+1684","🇦🇸","American Samoa"],["+376","🇦🇩","Andorra"],["+244","🇦🇴","Angola"],
        ["+1264","🇦🇮","Anguilla"],["+1268","🇦🇬","Antigua & Barbuda"],["+54","🇦🇷","Argentina"],
        ["+374","🇦🇲","Armenia"],["+297","🇦🇼","Aruba"],["+61","🇦🇺","Australia"],
        ["+43","🇦🇹","Austria"],["+994","🇦🇿","Azerbaijan"],["+1242","🇧🇸","Bahamas"],
        ["+973","🇧🇭","Bahrain"],["+880","🇧🇩","Bangladesh"],["+1246","🇧🇧","Barbados"],
        ["+375","🇧🇾","Belarus"],["+32","🇧🇪","Belgium"],["+501","🇧🇿","Belize"],
        ["+229","🇧🇯","Benin"],["+1441","🇧🇲","Bermuda"],["+975","🇧🇹","Bhutan"],
        ["+591","🇧🇴","Bolivia"],["+387","🇧🇦","Bosnia & Herzegovina"],["+267","🇧🇼","Botswana"],
        ["+55","🇧🇷","Brazil"],["+246","🇮🇴","British Indian Ocean Ter."],["+1284","🇻🇬","British Virgin Islands"],
        ["+673","🇧🇳","Brunei"],["+359","🇧🇬","Bulgaria"],["+226","🇧🇫","Burkina Faso"],
        ["+257","🇧🇮","Burundi"],["+238","🇨🇻","Cabo Verde"],["+855","🇰🇭","Cambodia"],
        ["+237","🇨🇲","Cameroon"],["+1","🇨🇦","Canada"],["+1345","🇰🇾","Cayman Islands"],
        ["+236","🇨🇫","Central African Republic"],["+235","🇹🇩","Chad"],["+56","🇨🇱","Chile"],
        ["+86","🇨🇳","China"],["+61","🇨🇽","Christmas Island"],["+61","🇨🇨","Cocos Islands"],
        ["+57","🇨🇴","Colombia"],["+269","🇰🇲","Comoros"],["+243","🇨🇩","Congo (DRC)"],
        ["+242","🇨🇬","Congo (Republic)"],["+682","🇨🇰","Cook Islands"],["+506","🇨🇷","Costa Rica"],
        ["+225","🇨🇮","Côte d'Ivoire"],["+385","🇭🇷","Croatia"],["+53","🇨🇺","Cuba"],
        ["+599","🇨🇼","Curaçao"],["+357","🇨🇾","Cyprus"],["+420","🇨🇿","Czech Republic"],
        ["+45","🇩🇰","Denmark"],["+253","🇩🇯","Djibouti"],["+1767","🇩🇲","Dominica"],
        ["+1809","🇩🇴","Dominican Republic"],["+593","🇪🇨","Ecuador"],["+20","🇪🇬","Egypt"],
        ["+503","🇸🇻","El Salvador"],["+240","🇬🇶","Equatorial Guinea"],["+291","🇪🇷","Eritrea"],
        ["+372","🇪🇪","Estonia"],["+268","🇸🇿","Eswatini"],["+251","🇪🇹","Ethiopia"],
        ["+500","🇫🇰","Falkland Islands"],["+298","🇫🇴","Faroe Islands"],["+679","🇫🇯","Fiji"],
        ["+358","🇫🇮","Finland"],["+33","🇫🇷","France"],["+594","🇬🇫","French Guiana"],
        ["+689","🇵🇫","French Polynesia"],["+241","🇬🇦","Gabon"],["+220","🇬🇲","Gambia"],
        ["+995","🇬🇪","Georgia"],["+49","🇩🇪","Germany"],["+233","🇬🇭","Ghana"],
        ["+350","🇬🇮","Gibraltar"],["+30","🇬🇷","Greece"],["+299","🇬🇱","Greenland"],
        ["+1473","🇬🇩","Grenada"],["+590","🇬🇵","Guadeloupe"],["+1671","🇬🇺","Guam"],
        ["+502","🇬🇹","Guatemala"],["+224","🇬🇳","Guinea"],["+245","🇬🇼","Guinea-Bissau"],
        ["+592","🇬🇾","Guyana"],["+509","🇭🇹","Haiti"],["+504","🇭🇳","Honduras"],
        ["+852","🇭🇰","Hong Kong"],["+36","🇭🇺","Hungary"],["+354","🇮🇸","Iceland"],
        ["+91","🇮🇳","India"],["+62","🇮🇩","Indonesia"],["+98","🇮🇷","Iran"],
        ["+964","🇮🇶","Iraq"],["+353","🇮🇪","Ireland"],["+972","🇮🇱","Israel"],
        ["+39","🇮🇹","Italy"],["+1876","🇯🇲","Jamaica"],["+81","🇯🇵","Japan"],
        ["+962","🇯🇴","Jordan"],["+7","🇰🇿","Kazakhstan"],["+254","🇰🇪","Kenya"],
        ["+686","🇰🇮","Kiribati"],["+383","🇽🇰","Kosovo"],["+965","🇰🇼","Kuwait"],
        ["+996","🇰🇬","Kyrgyzstan"],["+856","🇱🇦","Laos"],["+371","🇱🇻","Latvia"],
        ["+961","🇱🇧","Lebanon"],["+266","🇱🇸","Lesotho"],["+231","🇱🇷","Liberia"],
        ["+218","🇱🇾","Libya"],["+423","🇱🇮","Liechtenstein"],["+370","🇱🇹","Lithuania"],
        ["+352","🇱🇺","Luxembourg"],["+853","🇲🇴","Macao"],["+261","🇲🇬","Madagascar"],
        ["+265","🇲🇼","Malawi"],["+60","🇲🇾","Malaysia"],["+960","🇲🇻","Maldives"],
        ["+223","🇲🇱","Mali"],["+356","🇲🇹","Malta"],["+692","🇲🇭","Marshall Islands"],
        ["+596","🇲🇶","Martinique"],["+222","🇲🇷","Mauritania"],["+230","🇲🇺","Mauritius"],
        ["+52","🇲🇽","Mexico"],["+691","🇫🇲","Micronesia"],["+373","🇲🇩","Moldova"],
        ["+377","🇲🇨","Monaco"],["+976","🇲🇳","Mongolia"],["+382","🇲🇪","Montenegro"],
        ["+1664","🇲🇸","Montserrat"],["+212","🇲🇦","Morocco"],["+258","🇲🇿","Mozambique"],
        ["+95","🇲🇲","Myanmar"],["+264","🇳🇦","Namibia"],["+674","🇳🇷","Nauru"],
        ["+977","🇳🇵","Nepal"],["+31","🇳🇱","Netherlands"],["+687","🇳🇨","New Caledonia"],
        ["+64","🇳🇿","New Zealand"],["+505","🇳🇮","Nicaragua"],["+227","🇳🇪","Niger"],
        ["+234","🇳🇬","Nigeria"],["+683","🇳🇺","Niue"],["+672","🇳🇫","Norfolk Island"],
        ["+850","🇰🇵","North Korea"],["+389","🇲🇰","North Macedonia"],["+1670","🇲🇵","Northern Mariana Islands"],
        ["+47","🇳🇴","Norway"],["+968","🇴🇲","Oman"],["+92","🇵🇰","Pakistan"],
        ["+680","🇵🇼","Palau"],["+970","🇵🇸","Palestine"],["+507","🇵🇦","Panama"],
        ["+675","🇵🇬","Papua New Guinea"],["+595","🇵🇾","Paraguay"],["+51","🇵🇪","Peru"],
        ["+63","🇵🇭","Philippines"],["+48","🇵🇱","Poland"],["+351","🇵🇹","Portugal"],
        ["+1787","🇵🇷","Puerto Rico"],["+974","🇶🇦","Qatar"],["+262","🇷🇪","Réunion"],
        ["+40","🇷🇴","Romania"],["+7","🇷🇺","Russia"],["+250","🇷🇼","Rwanda"],
        ["+590","🇧🇱","Saint Barthélemy"],["+290","🇸🇭","Saint Helena"],["+1869","🇰🇳","Saint Kitts & Nevis"],
        ["+1758","🇱🇨","Saint Lucia"],["+1721","🇸🇽","Saint Martin"],["+508","🇵🇲","Saint Pierre & Miquelon"],
        ["+1784","🇻🇨","Saint Vincent & Grenadines"],["+685","🇼🇸","Samoa"],["+378","🇸🇲","San Marino"],
        ["+239","🇸🇹","São Tomé & Príncipe"],["+966","🇸🇦","Saudi Arabia"],["+221","🇸🇳","Senegal"],
        ["+381","🇷🇸","Serbia"],["+248","🇸🇨","Seychelles"],["+232","🇸🇱","Sierra Leone"],
        ["+65","🇸🇬","Singapore"],["+1721","🇸🇽","Sint Maarten"],["+421","🇸🇰","Slovakia"],
        ["+386","🇸🇮","Slovenia"],["+677","🇸🇧","Solomon Islands"],["+252","🇸🇴","Somalia"],
        ["+27","🇿🇦","South Africa"],["+82","🇰🇷","South Korea"],["+211","🇸🇸","South Sudan"],
        ["+34","🇪🇸","Spain"],["+94","🇱🇰","Sri Lanka"],["+249","🇸🇩","Sudan"],
        ["+597","🇸🇷","Suriname"],["+47","🇸🇯","Svalbard & Jan Mayen"],["+46","🇸🇪","Sweden"],
        ["+41","🇨🇭","Switzerland"],["+963","🇸🇾","Syria"],["+886","🇹🇼","Taiwan"],
        ["+992","🇹🇯","Tajikistan"],["+255","🇹🇿","Tanzania"],["+66","🇹🇭","Thailand"],
        ["+670","🇹🇱","Timor-Leste"],["+228","🇹🇬","Togo"],["+690","🇹🇰","Tokelau"],
        ["+676","🇹🇴","Tonga"],["+1868","🇹🇹","Trinidad & Tobago"],["+216","🇹🇳","Tunisia"],
        ["+90","🇹🇷","Turkey"],["+993","🇹🇲","Turkmenistan"],["+1649","🇹🇨","Turks & Caicos Islands"],
        ["+688","🇹🇻","Tuvalu"],["+256","🇺🇬","Uganda"],["+380","🇺🇦","Ukraine"],
        ["+971","🇦🇪","United Arab Emirates"],["+44","🇬🇧","United Kingdom"],["+1","🇺🇸","United States"],
        ["+598","🇺🇾","Uruguay"],["+1340","🇻🇮","US Virgin Islands"],["+998","🇺🇿","Uzbekistan"],
        ["+678","🇻🇺","Vanuatu"],["+379","🇻🇦","Vatican City"],["+58","🇻🇪","Venezuela"],
        ["+84","🇻🇳","Vietnam"],["+681","🇼🇫","Wallis & Futuna"],["+212","🇪🇭","Western Sahara"],
        ["+967","🇾🇪","Yemen"],["+260","🇿🇲","Zambia"],["+263","🇿🇼","Zimbabwe"]
      ];

      function _buildDialOptions(defaultCode) {
        return DIAL_COUNTRIES
          .sort((a, b) => a[2].localeCompare(b[2]))
          .map(([code, flag, name]) => {
            const sel = code === defaultCode ? ' selected' : '';
            return `<option value="${code}"${sel} title="${name}">${flag} ${code}</option>`;
          }).join('');
      }

      function _populateDialSelects() {
        // Try to detect user's country from timezone as a hint (best-effort)
        let defaultCode = "+268"; // Eswatini default given app origin
        try {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
          const tzMap = {
            "Africa/Mbabane":"+268","America/New_York":"+1","America/Chicago":"+1",
            "America/Denver":"+1","America/Los_Angeles":"+1","America/Toronto":"+1",
            "America/Vancouver":"+1","Europe/London":"+44","Europe/Paris":"+33",
            "Europe/Berlin":"+49","Europe/Rome":"+39","Europe/Madrid":"+34",
            "Africa/Johannesburg":"+27","Africa/Nairobi":"+254","Africa/Lagos":"+234",
            "Africa/Accra":"+233","Africa/Dar_es_Salaam":"+255","Africa/Kampala":"+256",
            "Africa/Lusaka":"+260","Africa/Harare":"+263","Africa/Addis_Ababa":"+251",
            "Africa/Cairo":"+20","Asia/Kolkata":"+91","Asia/Tokyo":"+81",
            "Asia/Shanghai":"+86","Asia/Seoul":"+82","Asia/Dubai":"+971",
            "Asia/Singapore":"+65","Australia/Sydney":"+61","Pacific/Auckland":"+64",
          };
          if (tzMap[tz]) defaultCode = tzMap[tz];
        } catch(e) {}
        const html = _buildDialOptions(defaultCode);
        ["login-dial-code","reg-dial-code"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.innerHTML = html;
        });
      }

      /*  BOOT*/

      function togglePw(fieldId, btn) {
        const input = document.getElementById(fieldId);
        if (!input) return;
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.innerHTML = showing
          ? '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
          : '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
        btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
        input.focus();
      }

      /* ── Lazy-load Intersection Observer ──────────────────────────────
         Uses IntersectionObserver for a smooth fade-in on content images.
         Handles three cases:
           1. Images present in the DOM at parse time (static HTML)
           2. Images injected later by JS (posts, avatars, comments)
           3. Images inside views that are display:none when first observed
              — re-scanned whenever goTo() makes a view visible.
      ──────────────────────────────────────────────────────────────── */
      /* ── Hide mobile nav on scroll down, reveal on scroll up ────────── */
      (function initNavHide() {
