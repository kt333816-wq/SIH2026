# Serviso

> **A platform where food meets the needy.**

Welcome to the official repository for the Serviso website! This is where the active development of the platform takes place, building a bridge between surplus food and those who need it most.

---

## Built With

This project is built using standard web technologies to ensure a fast, reliable, and accessible experience:

*   **HTML5**
*   **CSS3**
*   **JavaScript**
*   **SQL**

### External Services & APIs
*   **[Render](https://render.com/)** - Cloud application hosting
*   **[Neon.tech](https://neon.tech/)** - Serverless Postgres database
*   **[Cloudflare](https://www.cloudflare.com/)** - Security, performance, and CDN
*   **Cloudflare Turnstile** - Bot protection (`TURNSTILE_SITE_KEY`)
*   **[Brevo](https://www.brevo.com/)** - Transactional Email & OTP authentication (`BREVO_API_KEY`)
*   **[OpenStreetMap (OSM)](https://www.openstreetmap.org/)** - Free open-source map & geocoding API for locations

---

## Getting Started (Running Locally)

Because Serviso is a dynamic website that interacts with a database, you cannot simply double-click the HTML files to run it. You will need a local server environment. Follow these instructions to get a copy of the project running on your local machine for development and testing.

### Prerequisites

1. **Git:** To clone the repository.
2. **Local Web Server:** Download and install a software stack like **XAMPP**, **WAMP**, or **MAMP** (these come pre-packaged with an Apache web server and a local database environment).
3. **Code Editor:** VS Code, Sublime Text, Vim, or your preferred editor.

### Installation Steps

**1. Clone the repository**
Open your terminal or command prompt and run:
```bash
git clone [https://github.com/kt333816-wq/SIH2026.git](https://github.com/kt333816-wq/SIH2026.git) serviso
cd serviso
```


#### 2. Move to your server directory
If you are using **XAMPP**, place the project folder inside the server's root directory (`htdocs`):

* **Windows:** Move the `serviso` folder to `C:\xampp\htdocs\`
* **Mac:** Move the `serviso` folder to `/Applications/XAMPP/htdocs/`
* **Linux:** Move the `serviso` folder to `/opt/lampp/htdocs/`

#### 3. Configure Environment Variables
Create a `.env` or configuration file in the root directory (depending on your backend setup) and add your external API keys and database credentials:

```env
DATABASE_URL=your_neon_tech_sql_connection_string
TURNSTILE_SITE_KEY=your_cloudflare_turnstile_site_key
```

#### 4. Set up the Database
* **Cloud Database:** Since the project uses **Neon.tech**, you can connect your local setup directly to your Neon cloud database using the connection string above.
* **Local Database (Alternative):** If you prefer to test completely offline, open **phpMyAdmin** (usually found at `http://localhost/phpmyadmin`), create a new database named `serviso`, and import any provided SQL schema files from the repository.

#### 5. Run the application
1. Open your XAMPP / WAMP control panel and start the **Apache** server.
2. Open your web browser and navigate to:
   ```text
   http://localhost/serviso
   ```

---

## Contributing

We love community input! Meaningful contributions from users are highly encouraged and always accepted. 

To maintain code quality, please ensure your pull requests add genuine value. **Please avoid making unnecessary, trivial, or spammy pull requests.**

### Contribution Workflow

1. **Fork** the Project
2. **Create** your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. **Commit** your Changes (`git commit -m 'Add some AmazingFeature'`)
4. **Push** to the Branch (`git push origin feature/AmazingFeature`)
5. **Open** a Pull Request
