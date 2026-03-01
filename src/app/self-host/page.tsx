"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ArrowLeft, Copy, Moon, Sun, Github, 
  Database, Server, Container, Download, 
  CheckCircle, Terminal, FileJson, HardDrive,
  ExternalLink, AlertCircle
} from "lucide-react";
import { useTheme } from "next-themes";

function CodeBlock({ title, children, showLineNumbers = false }: { 
  title: string; 
  children: string;
  showLineNumbers?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = children.split('\n');

  return (
    <div className="rounded-xl overflow-hidden border border-border/50 shadow-sm">
      <div className="flex items-center justify-between bg-muted/80 px-4 py-2.5 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
        </div>
        <button 
          onClick={handleCopy} 
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
        >
          <Copy className="w-3 h-3" />
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="bg-zinc-950 text-zinc-300 text-xs font-mono overflow-x-auto">
        <pre className="p-4">
          {showLineNumbers ? (
            <div className="flex">
              <div className="select-none pr-4 text-zinc-600 text-right border-r border-zinc-800 mr-4">
                {lines.map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              <div>{children}</div>
            </div>
          ) : (
            children
          )}
        </pre>
      </div>
    </div>
  );
}

function StepCard({ 
  number, 
  title, 
  description, 
  icon: Icon,
  children 
}: { 
  number: number;
  title: string;
  description?: string;
  icon: React.ElementType;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative pl-12">
      <div className="absolute left-0 top-0 w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
        <span className="text-sm font-bold text-primary">{number}</span>
      </div>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold">{title}</h3>
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {children}
      </div>
    </div>
  );
}

function MethodCard({
  icon: Icon,
  title,
  description,
  recommended = false,
  time,
  difficulty,
  size
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  recommended?: boolean;
  time: string;
  difficulty: "Easy" | "Medium" | "Hard";
  size: string;
}) {
  const difficultyColors = {
    Easy: "text-emerald-500",
    Medium: "text-amber-500",
    Hard: "text-red-500"
  };

  return (
    <Card className={`relative overflow-hidden transition-all hover:shadow-lg ${recommended ? 'border-primary/30 ring-1 ring-primary/20' : ''}`}>
      {recommended && (
        <div className="absolute top-0 right-0">
          <div className="bg-primary text-primary-foreground text-[10px] font-medium px-2.5 py-1 rounded-bl-lg">
            Recommended
          </div>
        </div>
      )}
      <CardHeader className="pb-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="text-[10px]">
            ⏱️ {time}
          </Badge>
          <Badge variant="secondary" className={`text-[10px] ${difficultyColors[difficulty]}`}>
            ● {difficulty}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            💾 {size}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SelfHostPage() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background/80 backdrop-blur-md z-50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <span className="text-base font-bold">🇮🇩 wilayah-id</span>
          </div>
          <div className="flex items-center gap-1">
            <Link href="/docs">
              <Button variant="ghost" size="sm" className="text-xs h-8">Docs</Button>
            </Link>
            <a href="https://github.com/dhanyyudi/wilayah-id" target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Github className="h-4 w-4" />
              </Button>
            </a>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8" 
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            >
              {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/5 via-purple-500/5 to-transparent" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 rounded-full blur-[100px] -z-10" />
        
        <div className="max-w-4xl mx-auto px-4 py-16 sm:py-20 text-center relative">
          <Badge className="bg-primary/10 text-primary border-0 text-xs px-3 py-1 mb-6">
            🚀 Deploy Your Own Instance
          </Badge>
          <h1 className="text-4xl sm:text-5xl font-extrabold mb-4 tracking-tight">
            <span className="bg-gradient-to-r from-indigo-600 via-purple-500 to-pink-500 dark:from-indigo-400 dark:via-purple-400 dark:to-pink-400 bg-clip-text text-transparent">
              Self-Hosting Guide
            </span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Deploy wilayah-id on your own infrastructure for unlimited access, 
            zero rate limits, and complete data privacy.
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 pb-20 space-y-16">
        {/* Choose Your Method */}
        <section>
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Server className="w-5 h-5" />
            Choose Your Deployment Method
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MethodCard
              icon={Container}
              title="Docker Quickstart"
              description="One-command deployment with pre-built Docker image. Fastest way to get started."
              recommended
              time="5 min"
              difficulty="Easy"
              size="~500MB"
            />
            <MethodCard
              icon={Download}
              title="SQL Dump Restore"
              description="Download compressed database dump and restore to existing PostgreSQL."
              time="10 min"
              difficulty="Medium"
              size="~100MB"
            />
            <MethodCard
              icon={FileJson}
              title="Build from Source"
              description="Clone repo, run ETL pipeline, and build locally. Full control over data."
              time="30+ min"
              difficulty="Hard"
              size="~2GB"
            />
          </div>
        </section>

        <Separator />

        {/* Detailed Instructions */}
        <section>
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Terminal className="w-5 h-5" />
            Deployment Instructions
          </h2>

          <Tabs defaultValue="docker" className="space-y-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="docker">Docker</TabsTrigger>
              <TabsTrigger value="sql">SQL Dump</TabsTrigger>
              <TabsTrigger value="source">From Source</TabsTrigger>
            </TabsList>

            {/* Docker Method */}
            <TabsContent value="docker" className="space-y-6">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 flex gap-3">
                <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Recommended for most users</p>
                  <p className="text-sm text-muted-foreground">
                    Includes PostgreSQL, PostGIS, and pre-loaded data. No manual ETL required.
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                <StepCard 
                  number={1} 
                  title="Prerequisites" 
                  icon={HardDrive}
                  description="Docker 20+ and Docker Compose 2+ must be installed."
                >
                  <CodeBlock title="Check versions">{`docker --version
docker compose version`}</CodeBlock>
                </StepCard>

                <StepCard 
                  number={2} 
                  title="Download Compose File" 
                  icon={Download}
                  description="No need to clone the entire repo. Just download the compose file."
                >
                  <CodeBlock title="Terminal">{`mkdir wilayah-id && cd wilayah-id
curl -O https://raw.githubusercontent.com/dhanyyudi/wilayah-id/main/docker-compose.yml`}</CodeBlock>
                </StepCard>

                <StepCard 
                  number={3} 
                  title="Start Services" 
                  icon={Container}
                  description="This will download the pre-built image with data already loaded."
                >
                  <CodeBlock title="Terminal">{`docker compose up -d

# Wait for services to be ready (~30 seconds)
docker compose logs -f app`}</CodeBlock>
                </StepCard>

                <StepCard 
                  number={4} 
                  title="Verify Installation" 
                  icon={CheckCircle}
                >
                  <CodeBlock title="Test API">{`curl http://localhost:3000/api/v1/regions/provinces

# Expected: {"status":"success","data":[...],"meta":{"total":38}}`}</CodeBlock>
                </StepCard>
              </div>
            </TabsContent>

            {/* SQL Dump Method */}
            <TabsContent value="sql" className="space-y-6">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 flex gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Requires existing PostgreSQL</p>
                  <p className="text-sm text-muted-foreground">
                    You need PostgreSQL 15+ with PostGIS extension already installed.
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                <StepCard 
                  number={1} 
                  title="Download Database Dump" 
                  icon={Download}
                  description="Get the latest compressed SQL dump from GitHub Releases."
                >
                  <CodeBlock title="Terminal">{`# Download latest release
wget https://github.com/dhanyyudi/wilayah-id/releases/download/v1.0.0/wilayah_id_backup.sql.gz

# Verify file size (~100MB)
ls -lh wilayah_id_backup.sql.gz`}</CodeBlock>
                </StepCard>

                <StepCard 
                  number={2} 
                  title="Create Database" 
                  icon={Database}
                >
                  <CodeBlock title="PostgreSQL">{`createdb wilayah_id
psql -d wilayah_id -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql -d wilayah_id -c "CREATE EXTENSION IF NOT EXISTS postgis_topology;"`}</CodeBlock>
                </StepCard>

                <StepCard 
                  number={3} 
                  title="Restore Data" 
                  icon={Server}
                  description="Extract and restore the backup (~5 minutes)."
                >
                  <CodeBlock title="Terminal">{`# Decompress and restore
gunzip -c wilayah_id_backup.sql.gz | psql -d wilayah_id

# Or with pg_restore (if using custom format)
# pg_restore -d wilayah_id -j 4 wilayah_id_backup.dump`}</CodeBlock>
                </StepCard>

                <StepCard 
                  number={4} 
                  title="Clone & Configure App" 
                  icon={Terminal}
                >
                  <CodeBlock title="Terminal">{`git clone https://github.com/dhanyyudi/wilayah-id.git
cd wilayah-id

# Create environment file
cat > .env.local << 'EOF'
DATABASE_URL=postgresql://user:password@localhost:5432/wilayah_id
NEXT_PUBLIC_TILES_BASE_URL=/tiles
EOF`}</CodeBlock>
                </StepCard>

                <StepCard 
                  number={5} 
                  title="Run Application" 
                  icon={CheckCircle}
                >
                  <CodeBlock title="Terminal">{`pnpm install
pnpm build
pnpm start

# Or for development
pnpm dev`}</CodeBlock>
                </StepCard>
              </div>
            </TabsContent>

            {/* Source Method */}
            <TabsContent value="source" className="space-y-6">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 flex gap-3">
                <Database className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Full control, latest data</p>
                  <p className="text-sm text-muted-foreground">
                    Downloads raw data from sources and runs complete ETL pipeline.
                    Requires ~2GB disk space and 15-30 minutes.
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                <StepCard 
                  number={1} 
                  title="System Requirements" 
                  icon={HardDrive}
                >
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { name: "PostgreSQL", version: "15+ + PostGIS" },
                      { name: "Node.js", version: "18+" },
                      { name: "Python", version: "3.11+" },
                      { name: "Disk Space", version: "~2 GB free" },
                    ].map((req) => (
                      <div key={req.name} className="flex items-center justify-between p-2 rounded-lg bg-muted/50 text-xs">
                        <span className="font-medium">{req.name}</span>
                        <span className="text-muted-foreground">{req.version}</span>
                      </div>
                    ))}
                  </div>
                </StepCard>

                <StepCard 
                  number={2} 
                  title="Clone Repository" 
                  icon={Github}
                >
                  <CodeBlock title="Terminal">{`git clone https://github.com/dhanyyudi/wilayah-id.git
cd wilayah-id`}</CodeBlock>
                </StepCard>

                <StepCard 
                  number={3} 
                  title="Setup Database" 
                  icon={Database}
                >
                  <CodeBlock title="PostgreSQL">{`createdb wilayah_id
psql -d wilayah_id -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql -d wilayah_id -c "CREATE EXTENSION IF NOT EXISTS postgis_topology;"

# Update .env.local
cp .env.example .env.local
# Edit DATABASE_URL in .env.local`}</CodeBlock>
                </StepCard>

                <StepCard 
                  number={4} 
                  title="Run ETL Pipeline" 
                  icon={Server}
                  description="Downloads raw data and imports to database (~15-30 min)."
                >
                  <CodeBlock title="Terminal" showLineNumbers>{`# Setup Python environment
python -m venv etl-venv
source etl-venv/bin/activate  # Windows: etl-venv\\Scripts\\activate

# Install dependencies
pip install -r etl/requirements.txt

# Run ETL - this downloads and processes all data
python etl/import_all.py

# Generate vector tiles
python etl/generate_tiles.py`}</CodeBlock>
                </StepCard>

                <StepCard 
                  number={5} 
                  title="Build & Start" 
                  icon={CheckCircle}
                >
                  <CodeBlock title="Terminal">{`pnpm install
pnpm build
pnpm start`}</CodeBlock>
                </StepCard>
              </div>
            </TabsContent>
          </Tabs>
        </section>

        <Separator />

        {/* Environment Variables */}
        <section>
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Database className="w-5 h-5" />
            Configuration
          </h2>
          
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Environment Variables</CardTitle>
              <CardDescription>
                Create <code className="text-xs bg-muted px-1.5 py-0.5 rounded">.env.local</code> file with these settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CodeBlock title=".env.local">{`# Required - PostgreSQL connection
DATABASE_URL=postgresql://username:password@localhost:5432/wilayah_id

# Optional - Custom tile server URL (default: /tiles)
NEXT_PUBLIC_TILES_BASE_URL=/tiles

# Optional - API rate limiting (self-hosted = unlimited)
# RATE_LIMIT_REQUESTS=1000
# RATE_LIMIT_WINDOW=60000`}</CodeBlock>
            </CardContent>
          </Card>
        </section>

        <Separator />

        {/* Data Source Info */}
        <section className="bg-muted/30 rounded-2xl p-6 sm:p-8">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Database className="w-5 h-5" />
            About the Data
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center mb-6">
            <div className="p-4 rounded-xl bg-background/50">
              <div className="text-2xl font-bold text-primary">91,248</div>
              <div className="text-xs text-muted-foreground">Total Regions</div>
            </div>
            <div className="p-4 rounded-xl bg-background/50">
              <div className="text-2xl font-bold text-primary">77,721</div>
              <div className="text-xs text-muted-foreground">Postal Codes</div>
            </div>
            <div className="p-4 rounded-xl bg-background/50">
              <div className="text-2xl font-bold text-primary">~500MB</div>
              <div className="text-xs text-muted-foreground">Database Size</div>
            </div>
          </div>
          
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Data sourced from official Indonesian government records:
            </p>
            <ul className="space-y-1.5">
              {[
                { name: "Batas Administrasi (BIG)", url: "https://github.com/Alf-Anas/batas-administrasi-indonesia", desc: "Official boundary shapes from Badan Informasi Geospasial" },
                { name: "Kode Wilayah (Kemendagri)", url: "https://github.com/lokabisa-oss/region-id", desc: "Region codes from Ministry of Home Affairs" },
                { name: "Kode Pos (Pos Indonesia)", url: "https://github.com/lokabisa-oss/postal-code-id", desc: "Postal codes from Pos Indonesia" },
              ].map((source) => (
                <li key={source.name}>
                  <a 
                    href={source.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-foreground hover:text-primary transition-colors"
                  >
                    {source.name}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <span className="text-muted-foreground"> — {source.desc}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ / Troubleshooting */}
        <section>
          <h2 className="text-xl font-bold mb-6">Troubleshooting</h2>
          <div className="space-y-4">
            {[
              {
                q: "Database connection failed?",
                a: "Ensure PostgreSQL is running and accessible. Check DATABASE_URL format: postgresql://user:pass@host:port/dbname"
              },
              {
                q: "PostGIS extension not found?",
                a: "Install PostGIS: sudo apt-get install postgis (Ubuntu/Debian) or brew install postgis (macOS)"
              },
              {
                q: "Vector tiles not loading?",
                a: "Check that tiles were generated in public/tiles/ directory. Run python etl/generate_tiles.py if missing."
              },
              {
                q: "How to update data?",
                a: "For Docker: pull latest image. For SQL: download new dump and restore. For source: re-run ETL pipeline."
              }
            ].map((faq, i) => (
              <div key={i} className="p-4 rounded-lg border border-border/50 bg-muted/20">
                <p className="font-medium text-sm mb-1">Q: {faq.q}</p>
                <p className="text-sm text-muted-foreground">A: {faq.a}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="border-t bg-muted/20">
        <div className="max-w-4xl mx-auto px-4 py-8 text-center text-sm text-muted-foreground">
          <p>Need help? Open an issue on <a href="https://github.com/dhanyyudi/wilayah-id" target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">GitHub</a></p>
        </div>
      </footer>
    </div>
  );
}
