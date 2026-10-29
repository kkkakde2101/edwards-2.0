import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { CustomerDetail, CustomerInput, DuplicateWarning, Option } from '../../core/models';
import { controlError, fieldErrors, LookupService, problemMessage, todayIso, ToastService } from '../../core/support';
import { Modal } from '../../shared/ui';

const MESSAGES: Record<string, Record<string, string>> = {
  customerDate: { required: 'Enter the date.' },
  name: { required: 'Enter the customer name.' },
  address: { required: 'Enter the address.' },
  city: { required: 'Enter the city.' },
  district: { required: 'Enter the district.' },
  stateId: { required: 'Choose a state.' },
  pinCode: { required: 'Enter the pincode.', pattern: 'Enter a 6-digit pincode.' },
  gst: { pattern: 'Enter a 15-character GST number, for example 27AAAAA0000A1Z5.' },
  segmentId: { required: 'Choose a segment.' },
  accountTypeId: { required: 'Choose an account type.' },
  dealerId: { required: 'Choose a dealer.' },
  dealerUserId: { required: 'Choose the dealer engineer.' },
};

@Component({
  selector: 'app-customer-form',
  imports: [ReactiveFormsModule, RouterLink, Modal],
  templateUrl: './customer-form.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerForm implements OnInit {
  /** Set from the route on /customers/:id/edit; empty on /customers/new. */
  readonly id = input<string>();

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly lookups = inject(LookupService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);

  protected readonly form = this.fb.group({
    customerDate: this.fb.nonNullable.control(todayIso(), Validators.required),
    name: this.fb.nonNullable.control('', [Validators.required, Validators.minLength(2), Validators.maxLength(200)]),
    businessLineId: this.fb.control<number | null>(null),
    address: this.fb.nonNullable.control('', [Validators.required, Validators.maxLength(300)]),
    city: this.fb.nonNullable.control('', [Validators.required, Validators.maxLength(100)]),
    district: this.fb.nonNullable.control('', [Validators.required, Validators.maxLength(100)]),
    stateId: this.fb.control<number | null>(null, Validators.required),
    pinCode: this.fb.nonNullable.control('', [Validators.required, Validators.pattern(/^[1-9][0-9]{5}$/)]),
    gst: this.fb.nonNullable.control('', Validators.pattern(/^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z][Zz][0-9A-Za-z]$/)),
    segmentId: this.fb.control<number | null>(null, Validators.required),
    accountTypeId: this.fb.control<number | null>(null, Validators.required),
    dealerId: this.fb.control<number | null>(null, Validators.required),
    dealerUserId: this.fb.control<number | null>(null, Validators.required),
  });

  protected readonly states = toSignal(this.lookups.master('states'), { initialValue: [] });
  protected readonly segments = toSignal(this.lookups.master('segments'), { initialValue: [] });
  protected readonly accountTypes = toSignal(this.lookups.master('account-types'), { initialValue: [] });
  protected readonly businessLines = toSignal(this.lookups.master('business-lines'), { initialValue: [] });
  protected readonly dealers = toSignal(this.lookups.dealers(), { initialValue: [] });
  protected readonly engineers = signal<Option[]>([]);

  // An edit keeps showing the customer's current values even if they have since been deactivated.
  protected readonly stateOptions = computed(() => keep(this.states(), this.loaded()?.stateId, this.loaded()?.state));
  protected readonly segmentOptions = computed(() => keep(this.segments(), this.loaded()?.segmentId, this.loaded()?.segment));
  protected readonly accountTypeOptions = computed(() => keep(this.accountTypes(), this.loaded()?.accountTypeId, this.loaded()?.accountType));
  protected readonly businessLineOptions = computed(() => keep(this.businessLines(), this.loaded()?.businessLineId, this.loaded()?.businessLine));
  protected readonly dealerOptions = computed(() => {
    const list = this.dealers();
    const c = this.loaded();
    return c && !list.some((d) => d.id === c.dealerId) ? [...list, { id: c.dealerId, name: `${c.dealer} (inactive)`, zone: '', zoneId: 0 }] : list;
  });

  protected readonly isEdit = computed(() => !!this.id());
  protected readonly ownScope = computed(() => this.auth.me()?.scope === 'Own');
  protected readonly loaded = signal<CustomerDetail | null>(null);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly duplicates = signal<DuplicateWarning | null>(null);
  private readonly server = signal<Record<string, string>>({});
  private pendingEngineerId: number | null = null;

  constructor() {
    this.form.controls.dealerId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((dealerId) => this.loadEngineers(dealerId));

    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (Object.keys(this.server()).length) this.server.set({});
    });

    // A dealer or dealer user has exactly one dealer to choose from, so it is filled in for them.
    effect(() => {
      const list = this.dealers();
      if (!this.isEdit() && list.length === 1 && this.form.controls.dealerId.value === null) {
        this.form.controls.dealerId.setValue(list[0].id);
      }
    });
  }

  ngOnInit(): void {
    const id = this.id();
    if (!id) return;
    this.loading.set(true);
    this.http.get<CustomerDetail>(`/api/customers/${id}`).subscribe({
      next: (c) => {
        this.loaded.set(c);
        this.pendingEngineerId = c.dealerUserId;
        this.form.patchValue({
          customerDate: c.customerDate,
          name: c.name,
          businessLineId: c.businessLineId,
          address: c.address ?? '',
          city: c.city ?? '',
          district: c.district ?? '',
          stateId: c.stateId,
          pinCode: c.pinCode,
          gst: c.gst ?? '',
          segmentId: c.segmentId,
          accountTypeId: c.accountTypeId,
          dealerId: c.dealerId,
        });
        // Moving to another dealer goes through a customer transfer, so open work moves with the customer.
        this.form.controls.dealerId.disable({ emitEvent: false });
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(problemMessage(err, 'This customer could not be loaded.'));
      },
    });
  }

  protected err(name: string): string | null {
    return controlError(this.form, name, this.submitted(), this.server(), MESSAGES[name]);
  }

  protected save(confirmDuplicate = false): void {
    this.submitted.set(true);
    this.error.set(null);
    this.duplicates.set(null);
    if (this.form.invalid) {
      this.error.set('Some fields need attention. They are marked in red.');
      return;
    }

    const v = this.form.getRawValue();
    const body: CustomerInput = {
      customerDate: v.customerDate,
      name: v.name.trim(),
      address: v.address.trim(),
      city: v.city.trim(),
      district: v.district.trim(),
      stateId: v.stateId,
      pinCode: v.pinCode.trim(),
      gst: v.gst.trim() ? v.gst.trim().toUpperCase() : null,
      segmentId: v.segmentId,
      accountTypeId: v.accountTypeId,
      businessLineId: v.businessLineId,
      dealerId: v.dealerId,
      dealerUserId: v.dealerUserId,
      confirmDuplicate,
    };

    this.saving.set(true);
    const id = this.id();
    const request = id
      ? this.http.put<CustomerDetail>(`/api/customers/${id}`, body)
      : this.http.post<CustomerDetail>('/api/customers', body);
    request.subscribe({
      next: (c) => {
        this.toast.show(id ? 'Customer saved.' : 'Customer created.');
        void this.router.navigate(['/customers', c.id]);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        if (err instanceof HttpErrorResponse && err.status === 409 && (err.error as DuplicateWarning | null)?.code === 'duplicate') {
          this.duplicates.set(err.error as DuplicateWarning);
          return;
        }
        const fields = fieldErrors(err);
        this.server.set(fields);
        this.error.set(Object.keys(fields).length ? 'Some fields need attention. They are marked in red.' : problemMessage(err));
      },
    });
  }

  protected saveAnyway(): void {
    this.duplicates.set(null);
    this.save(true);
  }

  private loadEngineers(dealerId: number | null): void {
    this.engineers.set([]);
    const engineer = this.form.controls.dealerUserId;
    if (dealerId === null) {
      engineer.setValue(null);
      return;
    }
    this.lookups.dealerUsers(dealerId).subscribe((list) => {
      this.engineers.set(list);
      const wanted = this.pendingEngineerId ?? engineer.value;
      this.pendingEngineerId = null;
      if (list.some((e) => e.id === wanted)) engineer.setValue(wanted);
      else engineer.setValue(list.length === 1 ? list[0].id : null);
    });
  }
}

function keep(list: Option[], id: number | null | undefined, name: string | null | undefined): Option[] {
  if (id == null || !name || list.some((o) => o.id === id)) return list;
  return [...list, { id, name: `${name} (inactive)` }];
}
