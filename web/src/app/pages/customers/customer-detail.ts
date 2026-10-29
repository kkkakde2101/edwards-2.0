import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ContactInput, ContactItem, CustomerDetail as Customer, P } from '../../core/models';
import { controlError, fieldErrors, formatDate, problemMessage, ToastService } from '../../core/support';
import { CanDirective, Modal } from '../../shared/ui';
import { CustomerRelated } from './customer-related';

const CONTACT_MESSAGES: Record<string, Record<string, string>> = {
  personName: { required: 'Enter the contact name.' },
  email: { required: 'Enter an email address.' },
  mobile: { required: 'Enter a mobile number.', pattern: 'Enter a valid mobile number.' },
  landLine: { pattern: 'Enter a valid landline number.' },
};

@Component({
  selector: 'app-customer-detail',
  imports: [RouterLink, ReactiveFormsModule, CanDirective, Modal, CustomerRelated],
  templateUrl: './customer-detail.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerDetail implements OnInit {
  /** Customer id from the route. */
  readonly id = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly P = P;
  protected readonly date = formatDate;
  protected readonly customer = signal<Customer | null>(null);
  protected readonly contacts = signal<ContactItem[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmStatus = signal(false);
  protected readonly busy = signal(false);

  // Contact dialog
  protected readonly editing = signal<ContactItem | 'new' | null>(null);
  protected readonly contactSubmitted = signal(false);
  protected readonly contactError = signal<string | null>(null);
  private readonly contactServer = signal<Record<string, string>>({});
  protected readonly contactForm = this.fb.nonNullable.group({
    personName: ['', [Validators.required, Validators.maxLength(100)]],
    designation: ['', Validators.maxLength(250)],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(100)]],
    mobile: ['', [Validators.required, Validators.pattern(/^[0-9+\-() ]{7,20}$/)]],
    landLine: ['', Validators.pattern(/^[0-9+\-() ]{6,20}$/)],
    reportingTo: ['', Validators.maxLength(50)],
    department: ['', Validators.maxLength(100)],
  });

  ngOnInit(): void {
    this.load();
  }

  protected contactErr(name: string): string | null {
    return controlError(this.contactForm, name, this.contactSubmitted(), this.contactServer(), CONTACT_MESSAGES[name]);
  }

  protected setActive(active: boolean): void {
    const c = this.customer();
    if (!c) return;
    this.busy.set(true);
    this.http.post<void>(`/api/customers/${c.id}/${active ? 'activate' : 'deactivate'}`, {}).subscribe({
      next: () => {
        this.busy.set(false);
        this.confirmStatus.set(false);
        this.customer.set({ ...c, isActive: active });
        this.toast.show(active ? 'Customer reactivated.' : 'Customer deactivated.');
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.confirmStatus.set(false);
        this.toast.show(problemMessage(err), 'error');
      },
    });
  }

  protected openContact(contact: ContactItem | 'new'): void {
    this.contactSubmitted.set(false);
    this.contactError.set(null);
    this.contactServer.set({});
    this.contactForm.reset();
    if (contact !== 'new') {
      this.contactForm.setValue({
        personName: contact.personName,
        designation: contact.designation ?? '',
        email: contact.email,
        mobile: contact.mobile,
        landLine: contact.landLine ?? '',
        reportingTo: contact.reportingTo ?? '',
        department: contact.department ?? '',
      });
    }
    this.editing.set(contact);
  }

  protected saveContact(): void {
    this.contactSubmitted.set(true);
    this.contactServer.set({});
    this.contactError.set(null);
    if (this.contactForm.invalid) return;

    const editing = this.editing();
    const v = this.contactForm.getRawValue();
    const body: ContactInput = {
      personName: v.personName.trim(),
      designation: v.designation.trim() || null,
      email: v.email.trim(),
      mobile: v.mobile.trim(),
      landLine: v.landLine.trim() || null,
      reportingTo: v.reportingTo.trim() || null,
      department: v.department.trim() || null,
    };
    const base = `/api/customers/${this.id()}/contacts`;
    const request = editing === 'new' || editing === null
      ? this.http.post<ContactItem>(base, body)
      : this.http.put<ContactItem>(`${base}/${editing.id}`, body);

    this.busy.set(true);
    request.subscribe({
      next: (saved) => {
        this.busy.set(false);
        this.editing.set(null);
        this.contacts.update((list) => {
          const others = list.filter((c) => c.id !== saved.id);
          return [...others, saved].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.personName.localeCompare(b.personName));
        });
        this.toast.show(editing === 'new' ? 'Contact added.' : 'Contact saved.');
      },
      error: (err: unknown) => {
        this.busy.set(false);
        const fields = fieldErrors(err);
        this.contactServer.set(fields);
        if (!Object.keys(fields).length) this.contactError.set(problemMessage(err));
      },
    });
  }

  protected setContactActive(contact: ContactItem, active: boolean): void {
    this.http.post<ContactItem>(`/api/customers/${this.id()}/contacts/${contact.id}/${active ? 'activate' : 'deactivate'}`, {}).subscribe({
      next: (saved) => {
        this.contacts.update((list) => list.map((c) => (c.id === saved.id ? saved : c)));
        this.toast.show(active ? 'Contact reactivated.' : 'Contact deactivated.');
      },
      error: (err: unknown) => this.toast.show(problemMessage(err), 'error'),
    });
  }

  private load(): void {
    this.http.get<Customer>(`/api/customers/${this.id()}`).subscribe({
      next: (c) => this.customer.set(c),
      error: (err: unknown) => this.error.set(problemMessage(err, 'This customer could not be loaded.')),
    });
    this.http.get<ContactItem[]>(`/api/customers/${this.id()}/contacts`).subscribe({
      next: (list) => this.contacts.set(list),
      error: () => this.contacts.set([]),
    });
  }
}
