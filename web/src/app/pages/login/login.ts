import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { problemMessage } from '../../core/support';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    loginName: ['', Validators.required],
    password: ['', Validators.required],
  });
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly expired = this.route.snapshot.queryParamMap.has('expired');

  protected submit(): void {
    this.submitted.set(true);
    this.error.set(null);
    if (this.form.invalid) return;

    this.busy.set(true);
    const { loginName, password } = this.form.getRawValue();
    this.auth.login(loginName, password).subscribe({
      next: (me) => {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        const target = me.mustChangePassword ? '/change-password' : returnUrl && returnUrl.startsWith('/') ? returnUrl : '/';
        void this.router.navigateByUrl(target);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(problemMessage(err, 'Invalid login name or password.'));
      },
    });
  }
}
