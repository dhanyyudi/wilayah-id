from mcp.server.fastmcp import FastMCP
import psycopg2
from psycopg2.extras import RealDictCursor
import os
import json
from typing import Dict, Any, List, Optional
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Create FastMCP server
mcp = FastMCP("wilayah-id", description="Indonesian Administrative Regions (Wilayah-ID) API")

def get_db_connection():
    """Create a database connection to the read-only PostgreSQL instance."""
    # Use the DATABASE_URL environment variable (should point to the read-only user)
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise ValueError("DATABASE_URL environment variable is required")
    
    return psycopg2.connect(db_url, cursor_factory=RealDictCursor)


@mcp.tool()
async def search_regions(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    """
    Search for regions in Indonesia by name.
    Use this tools to find the required code for a province, district (kabupaten), 
    subdistrict (kecamatan), or village (desa) if only the name is known.
    
    Args:
        query: The name of the region to search for (e.g., "Jakarta", "Cimahi")
        limit: Maximum number of results to return (default: 20)
    """
    if len(query) < 2:
        return [{"error": "Search query must be at least 2 characters long."}]

    search_query = f"%{query.upper()}%"
    
    # Same SQL logic as the search API endpoint
    sql = """
    (
      SELECT 'PROVINSI' as tipe, kode_prov as kode, nama_provinsi as nama, 
             NULL as nama_provinsi, NULL as nama_kabupaten, NULL as nama_kecamatan
      FROM provinsi WHERE UPPER(nama_provinsi) LIKE %s
      LIMIT %s
    )
    UNION ALL
    (
      SELECT k.tipe, k.kode_kab as kode, k.nama_kabupaten as nama, 
             p.nama_provinsi, NULL as nama_kabupaten, NULL as nama_kecamatan
      FROM kabupaten k
      JOIN provinsi p ON k.kode_prov = p.kode_prov
      WHERE UPPER(k.nama_kabupaten) LIKE %s
      LIMIT %s
    )
    UNION ALL
    (
      SELECT 'KECAMATAN' as tipe, c.kode_kec as kode, c.nama_kecamatan as nama,
             p.nama_provinsi, k.nama_kabupaten, NULL as nama_kecamatan
      FROM kecamatan c
      JOIN kabupaten k ON c.kode_kab = k.kode_kab
      JOIN provinsi p ON k.kode_prov = p.kode_prov
      WHERE UPPER(c.nama_kecamatan) LIKE %s
      LIMIT %s
    )
    UNION ALL
    (
      SELECT d.tipe, d.kode_desa as kode, d.nama_desa as nama,
             p.nama_provinsi, k.nama_kabupaten, c.nama_kecamatan
      FROM desa d
      JOIN kecamatan c ON d.kode_kec = c.kode_kec
      JOIN kabupaten k ON d.kode_kab = k.kode_kab
      JOIN provinsi p ON d.kode_prov = p.kode_prov
      WHERE UPPER(d.nama_desa) LIKE %s
      LIMIT %s
    )
    ORDER BY tipe DESC, nama ASC
    LIMIT %s;
    """
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Pass the search_query and limit parameters for each union block, plus final limit
            params = (search_query, limit, search_query, limit, search_query, limit, search_query, limit, limit)
            cur.execute(sql, params)
            results = cur.fetchall()
            return [dict(row) for row in results]
    except Exception as e:
        return [{"error": f"Database query failed: {str(e)}"}]
    finally:
        conn.close()


@mcp.tool()
async def get_region_details(code: str) -> Dict[str, Any]:
    """
    Get detailed information about a specific region (Province, District, Subdistrict, or Village) 
    using its exact administrative code (`kode`).
    
    Args:
        code: The administrative code (e.g. '31' for Jakarta, '3173' for Jakarta Barat)
    """
    if not code or not code.isdigit():
        return {"error": "Invalid administrative code format."}

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            if len(code) == 2:  # Provinsi
                cur.execute("SELECT * FROM provinsi WHERE kode_prov = %s", (code,))
                row = cur.fetchone()
                if not row: return {"error": f"Province with code {code} not found."}
                
                # Exclude large geometry column for text output
                if 'geom' in row: del row['geom']
                
                # Get child count
                cur.execute("SELECT COUNT(*) as count FROM kabupaten WHERE kode_prov = %s", (code,))
                row['jumlah_kabupaten'] = cur.fetchone()['count']
                return dict(row)
                
            elif len(code) == 4:  # Kabupaten/Kota
                cur.execute("""
                    SELECT k.*, p.nama_provinsi 
                    FROM kabupaten k
                    JOIN provinsi p ON k.kode_prov = p.kode_prov
                    WHERE k.kode_kab = %s
                """, (code,))
                row = cur.fetchone()
                if not row: return {"error": f"District with code {code} not found."}
                if 'geom' in row: del row['geom']
                return dict(row)
                
            elif len(code) == 6:  # Kecamatan
                cur.execute("""
                    SELECT c.*, k.nama_kabupaten, p.nama_provinsi 
                    FROM kecamatan c
                    JOIN kabupaten k ON c.kode_kab = k.kode_kab
                    JOIN provinsi p ON c.kode_prov = p.kode_prov
                    WHERE c.kode_kec = %s
                """, (code,))
                row = cur.fetchone()
                if not row: return {"error": f"Subdistrict with code {code} not found."}
                if 'geom' in row: del row['geom']
                return dict(row)
                
            elif len(code) == 10:  # Desa/Kelurahan
                cur.execute("""
                    SELECT d.*, c.nama_kecamatan, k.nama_kabupaten, p.nama_provinsi, pc.kode_pos
                    FROM desa d
                    JOIN kecamatan c ON d.kode_kec = c.kode_kec
                    JOIN kabupaten k ON d.kode_kab = k.kode_kab
                    JOIN provinsi p ON d.kode_prov = p.kode_prov
                    LEFT JOIN postal_code pc ON d.kode_desa = pc.kode_desa
                    WHERE d.kode_desa = %s
                """, (code,))
                row = cur.fetchone()
                if not row: return {"error": f"Village with code {code} not found."}
                if 'geom' in row: del row['geom']
                return dict(row)
                
            else:
                return {"error": "Invalid code length. Expected 2, 4, 6, or 10 digits."}
                
    except Exception as e:
        return {"error": f"Database query failed: {str(e)}"}
    finally:
        conn.close()


@mcp.tool()
async def reverse_geocode(lat: float, lng: float) -> Dict[str, Any]:
    """
    Find the Indonesian administrative region (Province, District, Subdistrict, Village) 
    for a given latitude and longitude coordinate.
    
    Args:
        lat: Latitude (e.g., -6.200000)
        lng: Longitude (e.g., 106.816666)
    """
    # Validation based on Indonesia bounding box
    if not (-11.0 <= lat <= 6.0):
        return {"error": f"Latitude {lat} is outside Indonesia bounds (-11 to 6)."}
    if not (95.0 <= lng <= 141.0):
        return {"error": f"Longitude {lng} is outside Indonesia bounds (95 to 141)."}

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            sql = """
            WITH pt AS (
              SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326) AS geom
            )
            SELECT
              p.kode_prov, p.nama_provinsi,
              k.kode_kab, k.nama_kabupaten, k.tipe as tipe_kab,
              c.kode_kec, c.nama_kecamatan,
              d.kode_desa, d.nama_desa, d.tipe as tipe_desa, pc.kode_pos
            FROM pt
            LEFT JOIN desa d ON ST_Intersects(pt.geom, d.geom)
            LEFT JOIN kecamatan c ON d.kode_kec = c.kode_kec
            LEFT JOIN kabupaten k ON d.kode_kab = k.kode_kab
            LEFT JOIN provinsi p ON d.kode_prov = p.kode_prov
            LEFT JOIN postal_code pc ON d.kode_desa = pc.kode_desa;
            """
            cur.execute(sql, (lng, lat))
            row = cur.fetchone()
            
            if not row or not row['kode_prov']:
                return {
                    "result": "No land boundary found", 
                    "notes": "Coordinates are within Indonesia bounds but likely over water or border areas."
                }
                
            return {
                "coordinate": {"lat": lat, "lng": lng},
                "provinsi": {"kode": row['kode_prov'], "nama": row['nama_provinsi']},
                "kabupaten": {"kode": row['kode_kab'], "nama": row['nama_kabupaten'], "tipe": row['tipe_kab']},
                "kecamatan": {"kode": row['kode_kec'], "nama": row['nama_kecamatan']},
                "desa": {"kode": row['kode_desa'], "nama": row['nama_desa'], "tipe": row['tipe_desa'], "kode_pos": row['kode_pos']}
            }
    except Exception as e:
        return {"error": f"Database query failed: {str(e)}"}
    finally:
        conn.close()


@mcp.prompt()
def indonesian_region_assistant() -> str:
    """Prompt for assisting users with Indonesian administrative boundaries."""
    return """You are a geospatial data assistant specializing in Indonesian administrative boundaries (Wilayah Indonesia).

When helping users:
1. Use `search_regions` to find the administrative codes for names like "Jakarta", "Bandung", etc.
2. Use `get_region_details` to pull demographics and exact hierarchies based on the codes you found.
3. Use `reverse_geocode` when users provide GPS coordinates to tell them exactly which village/district they are in.

Important Context:
- The data source is Dukcapil 2024 (Semester 1).
- The hierarchy is: Provinsi (Province, 2 digits) → Kabupaten/Kota (District/City, 4 digits) → Kecamatan (Subdistrict, 6 digits) → Kelurahan/Desa (Village, 10 digits).
- The `DATABASE_URL` configured for these tools connects using a read-only database user. Data modification requests will not work and should not be attempted.
"""

if __name__ == "__main__":
    # Run the FastMCP server on stdio by default
    mcp.run()
