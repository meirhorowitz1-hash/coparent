import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Auth } from '@angular/fire/auth';
import { Observable, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Base API Service for communicating with the Node.js backend
 * Automatically injects Firebase Auth token into requests
 */
@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private http = inject(HttpClient);
  private auth = inject(Auth);
  
  private readonly baseUrl = environment.apiUrl;

  /**
   * Get authorization headers with Firebase token
   */
  private getAuthHeaders(): Observable<HttpHeaders> {
    return from(this.getToken()).pipe(
      switchMap(token => {
        if (!token) {
          return throwError(() => new Error('Not authenticated'));
        }
        return [new HttpHeaders({
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        })];
      })
    );
  }

  /**
   * Get current user's Firebase ID token
   */
  private async getToken(): Promise<string | null> {
    const user = this.auth.currentUser;
    if (!user) return null;
    
    // DEBUG: Log Firebase UID - remove after setup
    console.log('🔑 Firebase UID:', user.uid);
    console.log('📧 Email:', user.email);
    
    return user.getIdToken();
  }

  /**
   * GET request
   */
  get<T>(endpoint: string, params?: Record<string, string>): Observable<T> {
    return this.getAuthHeaders().pipe(
      switchMap(headers => {
        let httpParams = new HttpParams();
        if (params) {
          Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
              httpParams = httpParams.set(key, value);
            }
          });
        }
        return this.http.get<T>(`${this.baseUrl}${endpoint}`, { headers, params: httpParams });
      })
    );
  }

  /**
   * POST request
   */
  post<T>(endpoint: string, body: unknown = {}): Observable<T> {
    return this.getAuthHeaders().pipe(
      switchMap(headers => 
        this.http.post<T>(`${this.baseUrl}${endpoint}`, body, { headers })
      )
    );
  }

  /**
   * PATCH request
   */
  patch<T>(endpoint: string, body: unknown = {}): Observable<T> {
    return this.getAuthHeaders().pipe(
      switchMap(headers => 
        this.http.patch<T>(`${this.baseUrl}${endpoint}`, body, { headers })
      )
    );
  }

  /**
   * PUT request
   */
  put<T>(endpoint: string, body: unknown = {}): Observable<T> {
    return this.getAuthHeaders().pipe(
      switchMap(headers => 
        this.http.put<T>(`${this.baseUrl}${endpoint}`, body, { headers })
      )
    );
  }

  /**
   * DELETE request
   */
  delete<T>(endpoint: string): Observable<T> {
    return this.getAuthHeaders().pipe(
      switchMap(headers => 
        this.http.delete<T>(`${this.baseUrl}${endpoint}`, { headers })
      )
    );
  }

  /**
   * Upload file with multipart/form-data
   */
  upload<T>(endpoint: string, formData: FormData): Observable<T> {
    return from(this.getToken()).pipe(
      switchMap(token => {
        if (!token) {
          return throwError(() => new Error('Not authenticated'));
        }
        const headers = new HttpHeaders({
          'Authorization': `Bearer ${token}`
          // Don't set Content-Type - let browser set it with boundary
        });
        return this.http.post<T>(`${this.baseUrl}${endpoint}`, formData, { headers });
      })
    );
  }
}
